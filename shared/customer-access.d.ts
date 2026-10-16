
export type CustomerRole='rider'|'driver'|'merchant';
export const CUSTOMER_ROLES:CustomerRole[];
export function normalizeCustomerPhone(value:unknown):string;
export function resolveCustomerRole(profile:any,roleRows?:Array<string|{role:string}>):CustomerRole|null;
export function customerCapabilities(profile:any,wallets?:any[]):{customer:boolean;dashboard:boolean;read:boolean;purchase:boolean;load:boolean;create:boolean;transfer:boolean;payout:boolean;frozen:boolean;verified:boolean;approvalPending:boolean};
