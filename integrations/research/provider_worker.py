"""Only process with provider credentials. Parent kills it on absolute deadline."""
import ctypes
import json
import os
import resource
import sys
import urllib.request

resource.setrlimit(resource.RLIMIT_FSIZE, (262144, 262144))
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
if ctypes.CDLL(None).prctl(4, 0, 0, 0, 0) != 0:
    raise SystemExit('Provider isolation failed')
ready_fd = int(os.environ.pop('READY_FD'))
os.write(ready_fd, b'R')
os.close(ready_fd)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        return None


envelope = json.load(sys.stdin)
payload = envelope['request']
request = urllib.request.Request('https://integrate.api.nvidia.com/v1/chat/completions',
    data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + envelope['apiKey']})
try:
    with urllib.request.build_opener(NoRedirect).open(request, timeout=35) as response:
        data = response.read(262145)
        if len(data) > 262144:
            raise SystemExit('Provider output limit')
        result = json.loads(data)
except urllib.error.HTTPError as failure:
    result = {'providerStatus': failure.code}
except urllib.error.URLError as failure:
    import ssl
    result = {'providerFailure': 'tls' if isinstance(failure.reason, ssl.SSLError) else 'network'}
except Exception:
    result = {'providerFailure': 'invalid_response'}
sys.stdout.write(json.dumps(result))
