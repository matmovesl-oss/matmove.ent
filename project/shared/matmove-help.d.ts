
export type HelpContext = {role:'rider'|'driver'|'merchant'|'admin';isActive?:boolean;isOwner?:boolean;permissions?:string[]};
export type HelpAction = {label:string;destination:string};
export type HelpArticle = {id:string;title:string;answer:string;action:HelpAction};
export const HELP_VERSION:string;
export const HELP_ARTICLES:ReadonlyArray<HelpArticle & {roles:string[];terms:string[];permission:string|null}>;
export function helpTopics(context:HelpContext):Array<{id:string;title:string;action:HelpAction}>;
export function searchMatMoveHelp(question:string,context:HelpContext):{version:string;kind:'topics'|'answer'|'fallback'|'privacy';message:string;articles:HelpArticle[]};
