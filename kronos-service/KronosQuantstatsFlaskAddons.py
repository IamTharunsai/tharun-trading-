"""
INTEGRATION: Kronos Flask microservice additions
Add to: kronos-service/app.py

New endpoints:
1. /quantstats  — QuantStats HTML tearsheet
2. /freqai      — FreqAI-style ML feature engineering + prediction
"""

# ---- Add to requirements.txt ----
# quantstats>=0.0.62
# lightgbm>=4.0.0
# scikit-learn>=1.3.0
# ta-lib>=0.4.28  (for technical indicators)

import io
import json
import logging
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, Response
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ===============================
# ENDPOINT 1: QuantStats Tearsheet
# ===============================

def register_quantstats_route(app: Flask):
    @app.route('/quantstats', methods=['POST'])
    def generate_quantstats_tearsheet():
        """
        Generate a QuantStats HTML tearsheet from daily returns.

        Request body:
        {
          "returns": [0.02, -0.01, 0.005, ...],  // decimal daily returns
          "dates": ["2026-01-01", "2026-01-02", ...],
          "benchmark_returns": [...],  // optional, defaults to S&P 500 proxy
          "title": "APEX Trading Strategy"
        }
        """
        try:
            import quantstats as qs

            data = request.json
            if not data or not data.get('returns') or not data.get('dates'):
                return jsonify({'error': 'returns and dates are required'}), 400

            returns = pd.Series(
                data['returns'],
                index=pd.to_datetime(data['dates']),
                name=data.get('title', 'APEX Strategy'),
            )

            # Generate metrics dict first (cheaper than full HTML)
            metrics = {
                'total_return': float(qs.stats.comp(returns)),
                'cagr': float(qs.stats.cagr(returns)),
                'sharpe': float(qs.stats.sharpe(returns)),
                'sortino': float(qs.stats.sortino(returns)),
                'max_drawdown': float(qs.stats.max_drawdown(returns)),
                'calmar': float(qs.stats.calmar(returns)),
                'volatility': float(qs.stats.volatility(returns)),
                'win_rate': float(qs.stats.win_rate(returns)),
                'profit_factor': float(qs.stats.profit_factor(returns)),
                'recovery_factor': float(qs.stats.recovery_factor(returns)),
                'kelly_criterion': float(qs.stats.kelly_criterion(returns)),
                'value_at_risk': float(qs.stats.value_at_risk(returns)),
                'cvar': float(qs.stats.cvar(returns)),
            }

            # Generate full HTML report
            buf = io.StringIO()
            qs.reports.html(
                returns,
                output=buf,
                title=data.get('title', 'APEX Strategy'),
                benchmark=None,  # add SPY benchmark if you have the data
            )
            html = buf.getvalue()

            return jsonify({
                'html': html,
                'metrics': metrics,
            })

        except ImportError:
            return jsonify({'error': 'quantstats not installed. Run: pip install quantstats'}), 500
        except Exception as e:
            logger.error(f'QuantStats error: {e}')
            return jsonify({'error': str(e)}), 500


# ===============================
# ENDPOINT 2: FreqAI-style ML Predictions
# ===============================

def register_freqai_route(app: Flask):
    @app.route('/freqai/predict', methods=['POST'])
    def freqai_predict():
        """
        FreqAI-inspired ML prediction with feature engineering.

        Features (from freqtrade FreqAI):
        - RSI, MACD, Bollinger Bands, EMA ratios
        - Volume indicators (OBV, VWAP deviation)
        - Lag features (1d, 5d, 10d returns)
        - Rolling statistics (mean, std over 5/10/20 periods)

        Request body:
        {
          "ohlcv": [[open, high, low, close, volume], ...],  // last 100+ candles
          "predict_horizon": 5  // predict 5-candle ahead
        }
        """
        try:
            from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
            from sklearn.preprocessing import StandardScaler
            from sklearn.pipeline import Pipeline

            data = request.json
            ohlcv = np.array(data['ohlcv'])
            horizon = data.get('predict_horizon', 5)

            df = pd.DataFrame(ohlcv, columns=['open', 'high', 'low', 'close', 'volume'])

            # ---- Feature Engineering (FreqAI style) ----
            features = pd.DataFrame(index=df.index)

            # Price features
            features['returns_1d'] = df['close'].pct_change(1)
            features['returns_5d'] = df['close'].pct_change(5)
            features['returns_10d'] = df['close'].pct_change(10)

            # RSI
            delta = df['close'].diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, 1e-10)
            features['rsi14'] = 100 - (100 / (1 + rs))
            features['rsi_signal'] = (features['rsi14'] - 50) / 50  # normalize to [-1, 1]

            # MACD
            ema12 = df['close'].ewm(span=12).mean()
            ema26 = df['close'].ewm(span=26).mean()
            macd = ema12 - ema26
            signal = macd.ewm(span=9).mean()
            features['macd_hist'] = (macd - signal) / df['close']

            # Bollinger Bands
            sma20 = df['close'].rolling(20).mean()
            std20 = df['close'].rolling(20).std()
            features['bb_position'] = (df['close'] - sma20) / (2 * std20 + 1e-10)

            # EMA ratios
            features['ema_ratio_8_21'] = df['close'].ewm(span=8).mean() / df['close'].ewm(span=21).mean() - 1
            features['ema_ratio_21_50'] = df['close'].ewm(span=21).mean() / df['close'].ewm(span=50).mean() - 1

            # Volume
            features['volume_ratio'] = df['volume'] / df['volume'].rolling(20).mean()
            features['volume_ratio'] = features['volume_ratio'].clip(0, 10)

            # Rolling stats
            for window in [5, 10, 20]:
                features[f'ret_mean_{window}'] = features['returns_1d'].rolling(window).mean()
                features[f'ret_std_{window}'] = features['returns_1d'].rolling(window).std()

            # Target: was the return over the next `horizon` candles positive?
            target = (df['close'].shift(-horizon) > df['close']).astype(int)

            # Drop NaN rows
            valid_idx = features.dropna().index
            valid_target = target.dropna()
            common_idx = valid_idx.intersection(valid_target.index)

            X = features.loc[common_idx]
            y = target.loc[common_idx]

            if len(X) < 30:
                return jsonify({'error': f'Need at least 30 candles, got {len(X)}'}), 400

            # Train/test split (no shuffle — respect time order)
            split = int(len(X) * 0.8)
            X_train, X_test = X.iloc[:split], X.iloc[split:]
            y_train, y_test = y.iloc[:split], y.iloc[split:]

            # Train simple gradient boosting model
            pipeline = Pipeline([
                ('scaler', StandardScaler()),
                ('model', GradientBoostingClassifier(n_estimators=100, max_depth=3, random_state=42)),
            ])
            pipeline.fit(X_train, y_train)

            # Predict on latest candle
            latest_features = features.dropna().iloc[-1:][X_train.columns]

            if latest_features.empty:
                return jsonify({'error': 'Not enough data for prediction'}), 400

            prob_up = float(pipeline.predict_proba(latest_features)[0][1])
            signal = 'BUY' if prob_up > 0.6 else 'SELL' if prob_up < 0.4 else 'HOLD'

            # Test accuracy
            test_acc = float((pipeline.predict(X_test) == y_test).mean())

            # Feature importances
            feat_imp = dict(zip(X_train.columns, pipeline.named_steps['model'].feature_importances_))
            top_features = sorted(feat_imp.items(), key=lambda x: -x[1])[:5]

            return jsonify({
                'signal': signal,
                'probability_up': prob_up,
                'probability_down': 1 - prob_up,
                'confidence': abs(prob_up - 0.5) * 200,  # 0-100 scale
                'horizon_candles': horizon,
                'model_accuracy': test_acc,
                'training_samples': len(X_train),
                'top_features': [{'feature': f, 'importance': float(imp)} for f, imp in top_features],
            })

        except ImportError as e:
            return jsonify({'error': f'Missing package: {e}. Run: pip install scikit-learn lightgbm'}), 500
        except Exception as e:
            logger.error(f'FreqAI predict error: {e}', exc_info=True)
            return jsonify({'error': str(e)}), 500


# ---- In your main app.py, add: ----
# register_quantstats_route(app)
# register_freqai_route(app)
