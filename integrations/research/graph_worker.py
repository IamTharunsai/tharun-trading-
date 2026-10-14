import json
import resource
import sys
from pathlib import Path

resource.setrlimit(resource.RLIMIT_FSIZE, (1048576, 1048576))
resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
from graphify.serve import _load_graph, _query_graph_text

body = json.load(sys.stdin)
graph = _load_graph("/graph/graph.json")
text = _query_graph_text(graph, body["question"], depth=2, token_budget=1500, graph_path="public-bhishma-code")
pins = json.loads((Path(__file__).parent / "pins.json").read_text())
print(json.dumps({"text": text[:16000], "corpusCommit": pins["corpus"]["commit"],
                  "nodes": graph.number_of_nodes(), "edges": graph.number_of_edges()}))
