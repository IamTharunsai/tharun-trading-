import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from graph_provenance import normalize_graph


class GraphProvenance(unittest.TestCase):
    def fixture(self):
        return {'nodes': [{'id': 'source', 'label': 'source', 'source_file': '/corpus/frontend/vite.config.ts'},
                          {'id': 'vite', 'label': 'vite', 'file_type': 'code', 'source_file': 'vite', '_origin': 'ast'}],
                'edges': [{'source': 'source', 'target': 'vite', 'relation': 'dynamic_import'}]}

    def test_actual_rescued_import_shape_becomes_external_not_indexed_source(self):
        graph = self.fixture()
        self.assertEqual(normalize_graph(graph, {'frontend/vite.config.ts'}, lambda raw: raw), (1, 1))
        self.assertEqual(graph['nodes'][1]['source_file'], '')
        self.assertTrue(graph['nodes'][1]['external'])
        self.assertEqual(graph['nodes'][1]['moduleSpecifier'], 'vite')
        self.assertNotIn('_origin', graph['nodes'][1])

    def test_unapproved_source_cannot_masquerade_as_package_reference(self):
        for field, value in [('source_file', '../secret.py'), ('id', 'other'), ('source_location', 'line:1')]:
            graph = self.fixture()
            graph['nodes'][1][field] = value
            with self.assertRaises(ValueError):
                normalize_graph(graph, {'frontend/vite.config.ts'}, lambda raw: raw)
        graph = self.fixture()
        graph['edges'][0]['relation'] = 'calls'
        with self.assertRaises(ValueError):
            normalize_graph(graph, {'frontend/vite.config.ts'}, lambda raw: raw)

    def test_structural_definition_does_not_become_external_reference(self):
        graph = self.fixture()
        graph['edges'].append({'source': 'vite', 'target': 'source', 'relation': 'defines'})
        with self.assertRaises(ValueError):
            normalize_graph(graph, {'frontend/vite.config.ts'}, lambda raw: raw)

    def test_secondary_source_path_requires_manifest_membership(self):
        graph = self.fixture()
        graph['nodes'][0]['definition_file'] = '/home/private.py'
        with self.assertRaises(ValueError):
            normalize_graph(graph, {'frontend/vite.config.ts'}, lambda raw: raw)
