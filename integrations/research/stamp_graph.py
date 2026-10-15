import hashlib
import json
from pathlib import Path
from graph_provenance import normalize_graph
from graphify.ids import make_id

path = Path('/build/graphify-out/graph.json')
data = json.loads(path.read_text())
pins = json.loads(Path('/bridge/pins.json').read_text())
manifest = set(json.loads(Path('/corpus-manifest.json').read_text()))
nodes = data.get('nodes', [])
edges = data.get('edges', data.get('links', []))
if not nodes or not edges or len(nodes) > 200000 or path.stat().st_size > 33554432:
    raise SystemExit('Missing or oversized graph')
source_nodes, external_modules = normalize_graph(data, manifest, make_id)
data['built_at_commit'] = pins['corpus']['commit']
data['bhishma_corpus'] = {'repository': pins['corpus']['repository'], 'preparedFiles': len(manifest), 'sourceNodes': source_nodes, 'externalModuleReferences': external_modules,
                          'manifestSha256': hashlib.sha256(Path('/corpus-manifest.json').read_bytes()).hexdigest()}
Path('/graph').mkdir()
encoded = json.dumps(data).encode()
if len(encoded) > 33554432:
    raise SystemExit('Serialized graph too large')
Path('/graph/graph.json').write_bytes(encoded)
