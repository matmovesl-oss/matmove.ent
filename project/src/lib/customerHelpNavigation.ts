export function customerHelpSection(destination:string,role:string):'home'|'ride'|'wallet'|'trips'|'shop'|'inventory'|'account' {
 const common:Record<string,'home'|'ride'|'wallet'|'trips'|'account'>={home:'home',wallet:'wallet',trips:'trips',account:'account',kyc:'account',games:'home'};
 if(!['rider','driver','merchant'].includes(role))throw new Error('This customer role is not supported.');
 if(common[destination])return common[destination];
 if(destination==='ride'&&role!=='driver'||destination==='radar'&&role==='driver')return 'ride';
 if(destination==='shop'&&role==='rider')return 'shop';
 if(destination==='business'&&role==='merchant')return 'inventory';
 throw new Error('This section is not available to your role.');
}
