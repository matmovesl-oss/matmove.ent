
export const CUSTOMER_ROLES = ['rider', 'driver', 'merchant'];
export function normalizeCustomerPhone(value) {
 let phone=String(value||'').trim().replace(/[\s().-]/g,'');
 if (/^0\d{8}$/.test(phone)) phone='+232'+phone.slice(1);
 else if (/^\d{8}$/.test(phone)) phone='+232'+phone;
 else if (/^232\d{8}$/.test(phone)) phone='+'+phone;
 if (!/^\+[1-9]\d{7,14}$/.test(phone) || (phone.startsWith('+232')&&!/^\+232\d{8}$/.test(phone))) throw new Error('Enter a valid phone number, for example +232 76 000 000.');
 return phone;
}
export function resolveCustomerRole(profile,roleRows=[]) {
 if (!profile || (profile.role && !CUSTOMER_ROLES.includes(profile.role))) return null;
 const roles=[...new Set(roleRows.map(row=>typeof row==='string'?row:row?.role))];
 if (roles.some(role=>!CUSTOMER_ROLES.includes(role))) return null;
 if (roles.length===1) return profile.role&&profile.role!==roles[0]?null:roles[0];
 if (roles.length>1) return roles.includes(profile.role)?profile.role:null;
 return CUSTOMER_ROLES.includes(profile.role)?profile.role:null;
}
export function customerCapabilities(profile,wallets=[]) {
 const role=profile?.role,customer=CUSTOMER_ROLES.includes(role);
 const frozen=profile?.is_wallet_frozen===true||wallets.some(wallet=>wallet?.is_frozen===true);
 const verified=profile?.kyc_status==='approved';
 const approvedBusiness=role==='rider'||verified;
 return {customer,dashboard:customer,read:customer,purchase:customer&&!frozen&&approvedBusiness,load:customer&&!frozen&&approvedBusiness,create:customer&&!frozen&&approvedBusiness,transfer:customer&&!frozen&&verified,payout:customer&&!frozen&&verified,frozen,verified,approvalPending:customer&&role!=='rider'&&!verified};
}
