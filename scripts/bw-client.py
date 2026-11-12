#!/usr/bin/env python3
"""Load a Rebut bearer token through the existing bw-get workflow, in memory only."""
import os
from pathlib import Path
import subprocess
import sys

def main():
    root=Path(__file__).resolve().parent.parent
    if not os.environ.get('REBUT_ENDPOINT'):
        raise RuntimeError('Set REBUT_ENDPOINT to your authenticated Worker endpoint.')
    result=subprocess.run(['bw-get',os.environ.get('REBUT_BW_ITEM','Rebut — MCP Access Token')],capture_output=True,text=True,timeout=30)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError('bw-get could not retrieve the token. Restore your existing password-manager session first.')
    env=dict(os.environ,REBUT_TOKEN=result.stdout.strip())
    # Token is passed only through the child environment, never argv, files or stdout.
    return subprocess.run(['npx','--no-install','tsx',str(root/'scripts/client.ts'),*sys.argv[1:]],cwd=root,env=env).returncode

if __name__=='__main__':
    try: sys.exit(main())
    except (OSError,RuntimeError,subprocess.TimeoutExpired):
        sys.stderr.write('Rebut client setup failed. Check the endpoint and existing bw-get session; no automatic paid retry was attempted.\n')
        sys.exit(1)
