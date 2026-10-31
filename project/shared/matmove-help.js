
// MatMove Help v1: curated guidance, not a generative model or a live account reader.
// Keep answers aligned with shipped functions. Never put customer records in this file.
export const HELP_VERSION = '2026-10-28.1';
const customer = ['rider','driver','merchant'];
const entry = (id,title,roles,terms,answer,action,permission=null) => ({id,title,roles,terms,answer,action,permission});
export const HELP_ARTICLES = [
 entry('referrals','Invite friends and check rewards',customer,['referral','referrals','invite friend','promo','promo code','invite code','earn','reward history'],
  'Open Account, then Invite & Earn. Generate your personal code and share its signup link when registration is open. A new customer must record the optional code during signup before verification. Both people must pass eligibility checks; drivers and merchants also need Admin approval. Each eligible person can receive SLE 1. Pending or processing is not spendable money. Only Credited has a confirmed payment receipt. Refresh reward history to check the latest status; Needs review or Payment failed requires support, not another signup or payment. If the campaign is paused, keep your code and wait for reopening. Help cannot see your live rewards or make payments.',{label:'Open Account',destination:'account'}),
 entry('home','Find your way around MatMove',customer,['home','dashboard','guide','tutorial','start','use app','navigate'],
  'Home brings together your wallets and game shortcuts. Use Quick guide at the top to replay the walkthrough for your account. Account is also at the top; the bottom tabs open your other sections.',{label:'Open Home',destination:'home'}),
 entry('notifications','Read messages from MatMove',customer,['notification','notifications','bell','message','messages','broadcast','announcement','unread','mark read'],
  'Tap the bell beside Help and Account to read your MatMove messages. The badge counts unread messages. Use Mark read for one message or Mark all read for the messages available when the inbox was loaded. Refresh checks for new messages. A message link opens an app section; it never approves KYC or confirms a payment. These are in-app messages, not SMS or email.',{label:'Open Home',destination:'home'}),
 entry('kyc','Complete identity verification',customer,['kyc','verify','verification','identity','documents','skip','pending','approval','rejected'],
  'Open Account to continue identity verification. Skipping KYC keeps your account but does not unlock restricted wallet actions. Riders who complete the required KYC use the automatic rider checks; drivers and merchants await Admin approval. If rejected, read your private rejection reason and correct the submission. Approved legal identity details are locked; contact support for changes.',{label:'Open Account',destination:'account'}),
 entry('profile','Change your photo or display name',customer,['photo','avatar','picture','profile','display name','username'],
  'Open Account to upload a profile photo or change your display name, then save. A display name is separate from your verified legal identity. Changing your photo or display name does not change KYC approval.',{label:'Open Account',destination:'account'}),
 entry('load','Load your wallet with mobile money',customer,['load','topup','top up','fund','deposit','ussd','mobile money','orange','afrimoney','payment code'],
  'Open Wallet and choose Load. Enter the amount and review the total and fees shown before confirming. Use only the USSD code returned for that request. Wait for its confirmed status. If a request is pending or uncertain, check that same request instead of submitting another charge. After completion, start a new load for a fresh code. Help cannot check your live balance or confirm a payment.',{label:'Open Wallet',destination:'wallet'}),
 entry('balance','Show or hide wallet amounts',customer,['balance','eye','hide','hidden','sle','usd','currency','wallet'],
  'Wallet amounts start hidden. Use the eye beside your wallet to reveal or hide them and use the currency controls to view your wallets. Displayed currency labels matter: SLE and USD are different balances. Help cannot see or change your balance.',{label:'Open Wallet',destination:'wallet'}),
 entry('withdraw','Withdraw, pay out or transfer',customer,['withdraw','withdrawal','payout','pay out','transfer','send money','frozen'],
  'Open Wallet and choose the action you need. The app checks verification, approval, frozen status and available funds. Review the recipient and full total before confirming. Closing a pending payout does not cancel it: reopen it to check the original request. Only a confirmed receipt means it completed.',{label:'Open Wallet',destination:'wallet'}),
 entry('saved-places','Use Home and Work addresses',customer,['home address','work address','saved places','save address','location','coordinates','map','gps','pickup','destination','places'],
  'Save a Home or Work address using the address controls. For a ride, type a place and choose a suggestion to confirm its coordinates; text alone is not a confirmed location. If suggestions fail, use Find, the map pin or current location. Review pickup, destination and route before requesting.',{label:'Open Home',destination:'home'}),
 entry('ride','Request a ride or delivery',['rider','merchant'],['ride','delivery','schedule','scheduled','book','vehicle','fare','price','negotiate','driver'],
  'Open Ride, select confirmed pickup and destination locations, then review vehicle, service and fare. Where negotiation is available, review and accept the agreed fare. Agreeing a price is separate from payment confirmation. Track your existing request rather than creating duplicates.',{label:'Open Ride',destination:'ride'}),
 entry('radar','Review requests as a driver',['driver'],['radar','online','offline','ride','delivery','schedule','scheduled','request','accept','fare','negotiate','driver'],
  'Open Radar to review the requests available to your approved driver account. Review the exact fare and any offer before accepting. A pending negotiation or a request assigned to another driver cannot be accepted. Wait for the payment status before treating funds as confirmed.',{label:'Open Radar',destination:'radar'}),
 entry('trips','Check your trip history',customer,['trips','trip','history','booking','receipt','journey'],
  'Open Trips to review your journeys and their recorded statuses. A status or receipt must belong to your account. If a trip or payment looks wrong, keep its reference for support; Help cannot alter it.',{label:'Open Trips',destination:'trips'}),
 entry('shop','Browse merchant products',['rider'],['shop','product','buy','cart','checkout','merchant','shopping'],
  'Open Shop to browse products, then review the items, merchant and checkout total. Confirm currency, fees and delivery details before paying. An empty shop is only final after loading succeeds; use Retry if a read fails.',{label:'Open Shop',destination:'shop'}),
 entry('business','Manage your merchant inventory',['merchant'],['business','inventory','product','sell','merchant','shop','listing','price'],
  'Open Business to manage your product listings. Review product information and save changes using the controls available there. Check your merchant approval status in Account if wallet actions are blocked.',{label:'Open Business',destination:'business'}),
 entry('games','Play the four MatMove games',customer,['game','games','spin','wheel','rich dice','fruity','fruit','flue','flow','crankling','quonkra','prize','win','winning','bonus'],
  'Home and Games open the wheel, RICH DICE, Fruity Flue and CRANKLING. Landing-page demos are free and do not move money. Account games show their own fees, rules and eligibility before play. A result is not a credited prize until its transfer is confirmed. No game guarantees a win.',{label:'Open Games',destination:'games'}),
 entry('card','Understand saved card references',['rider','merchant'],['card','visa','mastercard','cvv','credit card','debit card','add card'],
  'Saved card references are labels with a brand and last four digits. They cannot make payments. Do not enter a full card number or CVV in Help or a reference field. Fund your wallet through the supported mobile money flow.',{label:'Open Home',destination:'home'}),
 entry('security','Protect your account',customer,['password','passcode','pin','login','security','logout','google','sign in'],
  'Keep your password, passcode and one-time codes private. Use Account for the security controls provided there. Google sign-in uses the configured Google flow; Help never needs your password or passcode and cannot unlock an account.',{label:'Open Account',destination:'account'}),
 entry('admin-overview','Understand the Admin overview',['admin'],['dashboard','overview','monitoring','counts','balance'],
  'Overview shows only assigned modules. Loading or unavailable data must not be treated as zero. Database wallet balances can be cached; use verified provider receipts for confirmed money movement. Keep currencies separate.',{label:'Open Overview',destination:'/dashboard'},'dashboard'),
 entry('admin-dispatch','Use Dispatch safely',['admin'],['dispatch','ride','delivery','schedule','driver','assign','cancel','fare'],
  'Open Dispatch to review requests and approved drivers. Review the current request version and exact customer fare before assigning. Once a payment exists, do not unassign or cancel through an unfunded-request action; follow the displayed payment or refund guidance.',{label:'Open Dispatch',destination:'/dispatch'},'dispatch'),
 entry('admin-kyc','Review customer KYC',['admin'],['kyc','approve','approval','reject','rejection','documents','verification','identity'],
  'Open KYC to review the specific submission and evidence. Rejection requires a clear reason visible only to that customer. Use the loaded review version; refresh a stale submission. Approved customer legal identity is locked against customer edits.',{label:'Open KYC',destination:'/kyc'},'kyc'),
 entry('admin-customers','Use Customer Governance',['admin'],['customer','customers','governance','user','name','email'],
  'Open Customer Governance to find registered accounts. Incomplete profiles may use email as their label; do not invent a legal name or imply a KYC submission exists. Access to this section does not grant unrelated assignments.',{label:'Open Customers',destination:'/customers'},'customers'),
 entry('admin-referrals','Review referral rewards and campaign',['admin'],['referral','referrals','promo','invite code','reward','reward history','referral recovery'],
  'Open Financials to review the separate referral treasury, campaign status and reward history. Financials access permits reading; only the active super admin can change the campaign or attach an existing reward receipt. Review the loaded settings version, budget and reason before confirming. Activation stays unavailable until server readiness is configured. Recovery requires the exact reward ID and original Monime transfer ID: inspect the receipt, review its amount and accounts, then confirm with a reason. Attachment records the original transfer and never sends money again. A lost response must reuse the retained request. Pending, processing, failed and review states are not credited rewards. Help cannot verify a live receipt or enable the campaign.',{label:'Open Financials',destination:'/financials'},'financials'),
 entry('admin-wallet','Review wallets and freezes',['admin'],['wallet','financial','freeze','frozen','balance','treasury','spin account'],
  'Open Financial & Wallets to review wallets. Distinguish customer balances from shared treasury funds and keep currencies separate. A freeze needs the exact wallet and reason; read its matching receipt before claiming success.',{label:'Open Financials',destination:'/financials'},'financials'),
 entry('admin-transactions','Review transaction receipts',['admin'],['transaction','payment','receipt','gateway','monime'],
  'Open Gateway Transactions to inspect recorded payments. Pending, failed or uncertain transfers are not confirmed receipts. Help cannot create a transfer, attach a receipt or reconcile a live payment.',{label:'Open Transactions',destination:'/transactions'},'transactions'),
 entry('admin-payouts','Review payouts and withdrawals',['admin'],['payout','withdraw','withdrawal','refund'],
  'Open Payouts & Withdrawals and inspect the original request and provider receipt. Do not create another payout because a response was lost. Use the existing recovery workflow and retain the original reference.',{label:'Open Payouts',destination:'/payouts'},'payouts'),
 entry('admin-staff','Manage staff access',['admin'],['staff','invite','hire','remove','permission','assignment','access denied'],
  'Open Staff to review assignments. Only the verified super admin can invite, remove or restore staff access. Operational administrators keep their assigned operational access without owner hiring rights. Removing staff access preserves the customer identity and financial history.',{label:'Open Staff',destination:'/staff'},'staff'),
 entry('admin-pricing','Edit vehicle pricing',['admin'],['pricing','price','vehicle','rate','fare setting'],
  'Open Vehicle Pricing to review and save the supported fare settings. Confirm the values before saving. Help describes the workflow and does not change prices.',{label:'Open Pricing',destination:'/pricing'},'pricing'),
 entry('admin-logs','Review audit and system logs',['admin'],['logs','audit','error','system'],
  'Open System & Audit Logs to inspect recorded operational events. Read errors require Retry and must not be presented as no events. Do not paste private KYC, passwords or secret keys into Help.',{label:'Open Logs',destination:'/logs'},'logs'),
 ...[
  ['overview','Review game outcomes','outcome overview'],['players','Review game players','player customer'],['entries','Review game entry payments','entry payment fee'],['winnings','Review game winnings','winning prize credited'],['settings','Edit game fees and prizes','settings fee odds prize'],['recovery','Recover an existing game receipt','recovery attach receipt']
 ].map(([tab,title,terms])=>entry(`admin-games-${tab}`,title,['admin'],['game','games',...terms.split(' ')],
  `Open the assigned Games tab: ${title}. Keep purchased rules and pending receipts intact when settings change. Recovery attaches a verified existing receipt; it must not resend money. Help cannot choose an outcome or credit a wallet.`,{label:title,destination:`/games?tab=${tab}`},`games.${tab}`)),
];
function words(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function allowed(a,context){
 if(!context||!a.roles.includes(context.role))return false;
 if(context.role!=='admin')return customer.includes(context.role);
 if(context.isActive!==true)return false;
 const grants=Array.isArray(context.permissions)?context.permissions:[];
 return context.isOwner===true||grants.includes(a.permission)||(a.permission?.startsWith('games.')&&grants.includes('games'));
}
export function helpTopics(context){return HELP_ARTICLES.filter(a=>allowed(a,context)).map(({id,title,action})=>({id,title,action:{...action}}));}
export function searchMatMoveHelp(question,context){
 const q=words(question).slice(0,500);
 if(!q)return {version:HELP_VERSION,kind:'topics',message:'Choose a topic or ask how to use a MatMove feature.',articles:[]};
 // Do not repeat entered secrets, or pretend this static guide can inspect accounts.
 if(/\b\d{6,}\b/.test(q)||/\b(api key|service role|secret|password is|passcode is|pin is|cvv is)\b/.test(q))
  return {version:HELP_VERSION,kind:'privacy',message:'Keep passwords, passcodes, card details and secret keys out of Help. Ask about the feature without private details.',articles:[]};
 const ranked=HELP_ARTICLES.filter(a=>allowed(a,context)).map(a=>{
  const score=a.terms.reduce((sum,term)=>sum+((' '+q+' ').includes(' '+words(term)+' ')?(words(term).includes(' ')?5:2):0),0);
  return {a,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.a.id.localeCompare(b.a.id));
 if(!ranked.length)return {version:HELP_VERSION,kind:'fallback',message:'I do not have a verified guide for that question. Try a feature name or contact MatMove support through your usual support channel. Do not share a passcode or private documents here.',articles:[]};
 return {version:HELP_VERSION,kind:'answer',message:'Guidance only. I cannot view live balances, approve accounts or perform actions for you.',articles:ranked.slice(0,3).map(({a})=>({id:a.id,title:a.title,answer:a.answer,action:{...a.action}}))};
}
