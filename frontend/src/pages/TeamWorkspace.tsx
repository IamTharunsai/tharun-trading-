import navigationPlate from '../../../assets/plates/atrium-navigation.png';
import westHeaderPlate from '../../../assets/plates/atrium-header-west.png';
import eastHeaderPlate from '../../../assets/plates/atrium-header-east.png';
import courtyardPlate from '../../../assets/plates/atrium-courtyard.png';
import '../styles/rainlight-layout.css';
import '../styles/rainlight.css';

/** First the approved architecture is calibrated without any simulated activity.
 * The workspace route is connected only after the assembled view is verified. */
export default function TeamWorkspacePage() {
  return (
    <main className="rainlight-world" aria-label="Rainlight Commons">
      <div className="rainlight-architecture" aria-hidden="true">
        <img className="rainlight-plate rainlight-plate--navigation" src={navigationPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--west" src={westHeaderPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--east" src={eastHeaderPlate} alt="" />
        <img className="rainlight-plate rainlight-plate--courtyard" src={courtyardPlate} alt="" />
      </div>
    </main>
  );
}
