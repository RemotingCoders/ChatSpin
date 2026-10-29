// Only known provider status codes are surfaced. Never return raw provider messages,
// which may contain submitted text, identifiers or authorization details.
export function aiFailure(error:unknown,fallback:string){
 const value=error as {status?:number;code?:string}|undefined;
 if(value?.status===401)return 'AI authentication failed. Check the server API key.';
 if(value?.status===403)return 'AI access denied. Check project and model permissions.';
 if(value?.status===429&&value.code==='insufficient_quota')return 'AI quota exhausted. Check API billing and project limits.';
 if(value?.status===429)return 'AI rate limit reached. Retry queued.';
 return fallback;
}
