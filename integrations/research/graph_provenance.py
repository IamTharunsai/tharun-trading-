"""Distinguish indexed source from pinned extractor's rescued package references."""
import re


def relative_source(value):
    if not isinstance(value, str):
        raise ValueError('Invalid source path')
    return value.replace('\\', '/').removeprefix('/corpus/').removeprefix('./')


def normalize_graph(data, manifest, make_id):
    nodes = data.get('nodes', [])
    edges = data.get('edges', data.get('links', []))
    if not nodes or not edges or len(nodes) > 200000:
        raise ValueError('Missing or oversized graph')
    by_id = {node['id']: node for node in nodes}
    if len(by_id) != len(nodes):
        raise ValueError('Duplicate graph IDs')
    source_nodes, external_modules = 0, 0
    for node in nodes:
        source = node.get('source_file')
        if not source:
            continue
        relative = relative_source(source)
        if relative not in manifest:
            # JS/TS dynamic-import rescue emits a package-shaped code stub.
            # It is a dependency reference, never proof that package source was indexed.
            bare = bool(re.fullmatch(r'(?:@[A-Za-z0-9_-]+/)?[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:/[A-Za-z0-9_.-]+)*', source))
            approved_import = any(edge.get('target') == node['id'] and edge.get('relation') == 'dynamic_import'
                and relative_source(by_id.get(edge.get('source'), {}).get('source_file', '')) in manifest for edge in edges)
            structural = any(edge.get('source') == node['id'] and edge.get('relation') in ('contains', 'defines') for edge in edges)
            if not (bare and node.get('label') == source and node['id'] == make_id(source.split('/')[-1])
                    and not node.get('source_location') and approved_import and not structural):
                raise ValueError('Graph source outside approved corpus: ' + repr(source[:200]))
            node.update(file_type='concept', type='external', external=True, source_file='',
                        source_location=None, moduleSpecifier=source)
            node.pop('_origin', None)
            external_modules += 1
            continue
        source_nodes += 1
        for field in ('origin_file', 'definition_file'):
            if node.get(field) and relative_source(node[field]) not in manifest:
                raise ValueError('Unverified secondary source path')
    if not source_nodes:
        raise ValueError('Graph has no indexed source')
    return source_nodes, external_modules
