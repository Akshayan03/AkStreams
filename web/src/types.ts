export type Sport = 'all' | 'soccer' | 'basketball';
export type GameStatus = 'live' | 'scheduled' | 'final' | 'postponed' | 'canceled';
export type Event = {
  id: string; sport:'soccer'|'basketball'; league:string;
  home:string;away:string;homeShort:string;awayShort:string;
  homeLogo:string;awayLogo:string;homeScore:string|null;awayScore:string|null;
  kickoff:string;status:GameStatus;clock:string;venue?:string;broadcasters:string[];isDemo:boolean;
};
export type Source = {
  id:string;provider:string;title:string;kind:'hls'|'youtube'|'external';
  url:string;videoId?:string;confidence:number;reason:string;status:'playable'|'candidate';
  origin?:string;isTest?:boolean;
};
export type Provider = {id:string;name:string;enabled:boolean;description:string;kind?:string;
  issues?:string[];lastError?:string;lastErrorAt?:string;lastSuccessAt?:string;channelCount?:number};
export type ProviderResult = {id:string;name:string;status:'ok'|'partial'|'skipped'|'not-configured'|'error';count:number;detail:string};
export type EventResponse = {events:Event[];partial:boolean;unavailable?:boolean;errors:string[];fetchedAt:string;date:string;timeZone:string};
export type SourceResponse = {event:Event;sources:Source[];providers:Provider[];providerErrors:string[];providerResults:ProviderResult[];searchedAt:string};
export type Channel = {title:string;channel:string;group:string;origin:string;url:string;kind:'hls'|'external'};
export type ChannelResponse = {channels:Channel[];errors:string[];configured:boolean};
