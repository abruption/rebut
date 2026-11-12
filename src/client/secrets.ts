import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import type { Settings } from "./settings.js";
const KEYCHAIN = String.raw`ObjC.import('Foundation');ObjC.import('Security');
ObjC.bindFunction('SecItemCopyMatching',['int',['id','id*']]);ObjC.bindFunction('SecKeychainOpen',['int',['char*','id*']]);ObjC.bindFunction('SecKeychainGetStatus',['int',['id','unsigned int*']]);
const input=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,$.NSUTF8StringEncoding)));
if(input.service!=='com.abruption.rebut'||input.account!=='codex-mcp-bearer')throw Error('Invalid identity');
const ref=Ref();let stage='open',status=$.SecKeychainOpen(ObjC.unwrap($.NSHomeDirectory())+'/Library/Keychains/login.keychain-db',ref),value=null;
function attrs(){const q=$.NSMutableDictionary.alloc.init;q.setObjectForKey($('genp'),$('class'));q.setObjectForKey($(input.service),$('svce'));q.setObjectForKey($(input.account),$('acct'));return q;}
if(status===0){stage='status';const flags=Ref();status=$.SecKeychainGetStatus(ref[0],flags);}
if(status===0){const q=attrs();q.setObjectForKey($.NSArray.arrayWithObject(ref[0]),$('m_SearchList'));
if(input.action==='store'){const data=$(input.value).dataUsingEncoding($.NSUTF8StringEncoding);const changes=$.NSMutableDictionary.alloc.init;changes.setObjectForKey(data,$('v_Data'));stage='update';status=$.SecItemUpdate(q,changes);if(status===-25300){const add=attrs();add.setObjectForKey(data,$('v_Data'));add.setObjectForKey(ref[0],$('u_Keychain'));stage='add';status=$.SecItemAdd(add,null);}}
else if(input.action==='load'){q.setObjectForKey($(true),$('r_Data'));q.setObjectForKey($('m_LimitOne'),$('m_Limit'));const result=Ref();stage='load';status=$.SecItemCopyMatching(q,result);if(status===0)value=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(result[0],$.NSUTF8StringEncoding));}else{status=-50;stage='action';}}
$.NSFileHandle.fileHandleWithStandardOutput.writeData($(JSON.stringify({status,stage,value})).dataUsingEncoding($.NSUTF8StringEncoding));`;
export function validateToken(token: string): string {
  if (!/^[\x21-\x7e]{32,512}$/.test(token)) throw new Error("TOKEN_INVALID");
  return token;
}
function keychain(
  action: "load" | "store",
  value?: string,
): string | undefined {
  if (process.platform !== "darwin") throw new Error("KEYCHAIN_UNSUPPORTED");
  const result = spawnSync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", KEYCHAIN],
    {
      input: JSON.stringify({
        action,
        service: "com.abruption.rebut",
        account: "codex-mcp-bearer",
        ...(value ? { value } : {}),
      }),
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 8192,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error("KEYCHAIN_UNAVAILABLE");
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("KEYCHAIN_UNAVAILABLE");
  }
  if (parsed.status !== 0) throw new Error("KEYCHAIN_UNAVAILABLE");
  return action === "load" ? validateToken(parsed.value) : undefined;
}
export async function storeToken(
  token: string,
  settings: Settings,
): Promise<void> {
  validateToken(token);
  if (settings.secretStore !== "keychain")
    throw new Error("TOKEN_STORAGE_REQUIRES_KEYCHAIN");
  keychain("store", token);
  if (keychain("load") !== token) throw new Error("KEYCHAIN_READBACK_FAILED");
}
export async function loadToken(settings: Settings): Promise<string> {
  if (settings.secretStore === "env")
    return validateToken(process.env.REBUT_TOKEN || "");
  if (settings.secretStore === "keychain") return keychain("load")!;
  const executable = process.env.REBUT_BW_GET || "bw-get";
  const result = spawnSync(executable, [settings.vaultwardenItem], {
    input: "",
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 8192,
    env: {
      ...process.env,
      PATH: [
        dirname(process.execPath),
        join(homedir(), ".local", "bin"),
        process.env.PATH || "",
      ].join(delimiter),
    },
  });
  if (result.error || result.status !== 0)
    throw new Error("VAULTWARDEN_UNAVAILABLE");
  return validateToken(result.stdout.trim());
}
