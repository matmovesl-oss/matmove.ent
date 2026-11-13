import {useId} from 'react';

export type MatMoveVehicleKind = 'keke' | 'bike' | 'car' | 'van';

type VehicleStickerProps = { kind: MatMoveVehicleKind; size?: number; className?: string };
export function VehicleSticker({kind,size=88,className=''}:VehicleStickerProps){
  const uid=useId().replace(/:/g,'');
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[22px] bg-gradient-to-br from-white via-[#f5fbf7] to-[#e5f1ff] shadow-[inset_0_1px_0_rgba(255,255,255,.95),0_5px_16px_rgba(15,35,55,.08)] ${className}`} style={{width:size,height:size*.72}}>
    <svg viewBox="0 0 160 116" width="100%" height="100%" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`mm-body-${kind}`} x1="22" y1="24" x2="132" y2="105" gradientUnits="userSpaceOnUse"><stop stopColor="#fff"/><stop offset=".7" stopColor="#e7eef0"/><stop offset="1" stopColor="#cbd7dc"/></linearGradient>
        <linearGradient id={`mm-green-${kind}`} x1="20" y1="45" x2="142" y2="88" gradientUnits="userSpaceOnUse"><stop stopColor="#16d34b"/><stop offset="1" stopColor="#008f58"/></linearGradient>
        <linearGradient id={`mm-blue-${kind}`} x1="22" y1="82" x2="142" y2="102" gradientUnits="userSpaceOnUse"><stop stopColor="#2879f2"/><stop offset="1" stopColor="#073fae"/></linearGradient>
        <filter id={`mm-shadow-${kind}`} x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#17324b" floodOpacity=".22"/></filter>
      </defs>
      <ellipse cx="81" cy="101" rx="59" ry="7" fill="#94a3b8" opacity=".2"/>
      {kind==='car'&&<g filter={`url(#mm-shadow-${kind})`}>
        <path d="M20 74 28 58 51 52 66 31Q70 25 80 25h34q10 0 16 9l15 22 7 9 2 20q-1 7-9 8h-8a17 17 0 0 0-33 0H66a17 17 0 0 0-33 0h-9q-7 0-7-8l3-11Z" fill={`url(#mm-body-${kind})`} stroke="#9aa9b4" strokeWidth="2"/>
        <path d="m62 33-13 19h39V29H77q-9 0-15 4Zm31-4v23h38l-12-17q-4-6-12-6H93Z" fill="#172633" stroke="#34495a" strokeWidth="2"/>
        <path d="M19 70q36-7 66-1 37 8 85-1v10q-45 10-85 2-35-6-66 1Z" fill={`url(#mm-green-${kind})`}/>
        <path d="M20 83q38-4 65 1 38 7 82-1l-2 10q-44 8-80 1-33-5-64 0Z" fill={`url(#mm-blue-${kind})`}/>
        <path d="M144 62 155 66v8l-11-1ZM23 62l-8 5v8l8-1" fill="#f8fafc" stroke="#94a3b8"/>
        <circle cx="50" cy="88" r="12" fill="#182635"/><circle cx="50" cy="88" r="6" fill="#b9c7d0"/><circle cx="127" cy="88" r="12" fill="#182635"/><circle cx="127" cy="88" r="6" fill="#b9c7d0"/>
      </g>}
      {kind==='van'&&<g filter={`url(#mm-shadow-${kind})`}>
        <path d="M15 42q0-13 14-13h80q13 0 19 10l16 23 5 7v19q0 7-8 7h-8a17 17 0 0 0-33 0H55a17 17 0 0 0-33 0h-6q-5 0-5-6V42Z" fill={`url(#mm-body-${kind})`} stroke="#9aa9b4" strokeWidth="2"/>
        <path d="M29 34h29v26H22V42q0-8 7-8Zm36 0h33v26H65V34Zm40 0h4q7 0 11 7l12 19h-27V34Z" fill="#162632" stroke="#526879" strokeWidth="2"/>
        <path d="M14 65q44 6 75 2 35-4 60 1v15q-39 5-76 1-31-4-59-1Z" fill={`url(#mm-green-${kind})`}/>
        <path d="M14 83q32-4 60 0 35 6 75 0v8q-42 9-77 3-29-4-58 0Z" fill={`url(#mm-blue-${kind})`}/>
        <path d="M17 63h136" stroke="#fff" strokeWidth="3" opacity=".8"/>
        <circle cx="38" cy="88" r="12" fill="#172635"/><circle cx="38" cy="88" r="6" fill="#c7d2d9"/><circle cx="119" cy="88" r="12" fill="#172635"/><circle cx="119" cy="88" r="6" fill="#c7d2d9"/>
      </g>}
      {kind==='keke'&&<g filter={`url(#mm-shadow-${kind})`}>
        <path d="M39 28q0-9 10-9h40q7 0 12 7l21 31 5 29H30l5-44q1-8 4-14Z" fill={`url(#mm-body-${kind})`} stroke="#91a5b0" strokeWidth="2"/>
        <path d="M47 27q2-5 9-5h29q7 0 11 7l13 22H43l4-24Z" fill="#172936"/>
        <path d="M41 31h13v20H41l-2 23h-8l4-38q1-3 6-5Z" fill="#101f2c" opacity=".95"/>
        <path d="M42 53h75l7 21H33l4-16q1-5 5-5Z" fill={`url(#mm-green-${kind})`}/>
        <path d="M32 75h92l-2 14H30l2-14Z" fill={`url(#mm-blue-${kind})`}/>
        <path d="M57 31h26v18H57V31Z" fill="#8fc2d8" opacity=".3"/>
        <path d="M121 53h8l8 15h-14l-2-15ZM35 61H25l-7 13h14l3-13Z" fill="#f8fafc" stroke="#95a7b2"/>
        <circle cx="45" cy="88" r="11" fill="#172635"/><circle cx="45" cy="88" r="5" fill="#bdcbd3"/><circle cx="111" cy="88" r="11" fill="#172635"/><circle cx="111" cy="88" r="5" fill="#bdcbd3"/>
      </g>}
      {kind==='bike'&&<g filter={`url(#mm-shadow-${kind})`}>
        <circle cx="38" cy="82" r="19" fill="#122334"/><circle cx="38" cy="82" r="12" fill="#c6d2d8"/><circle cx="38" cy="82" r="5" fill="#566a79"/>
        <circle cx="124" cy="82" r="19" fill="#122334"/><circle cx="124" cy="82" r="12" fill="#c6d2d8"/><circle cx="124" cy="82" r="5" fill="#566a79"/>
        <path d="m38 82 22-29 20 29H38l16-22 27 0 18 22" stroke="#14283a" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="m58 52 23-3 10 10-21 12-20-5Z" fill={`url(#mm-green-${kind})`} stroke="#087d4d" strokeWidth="2"/>
        <path d="m73 46 20-5 15 6-8 12-21-1Z" fill={`url(#mm-body-${kind})`} stroke="#8da0aa" strokeWidth="2"/>
        <path d="m46 73 22 7-5 9-29-2Z" fill={`url(#mm-blue-${kind})`}/>
        <path d="m91 53 12-17 9 2-8 21M103 37l17-7 3 4-16 9" stroke="#172635" strokeWidth="4" strokeLinecap="round"/>
        <path d="m57 49-9-10-16 2" stroke="#172635" strokeWidth="3.5" strokeLinecap="round"/>
        <path d="m73 44 5-13 13-4 13 5-2 12Z" fill="#f7fafc" stroke="#a7b5be" strokeWidth="2"/>
        <circle cx="89" cy="28" r="10" fill="#172635"/><path d="M80 29q5-12 18-4l1 6-17 2Z" fill={`url(#mm-green-${kind})`}/>
        <path d="m84 39 15 8-5 13-18-4-8-11Z" fill="#162b3d"/><path d="m80 50 18 3 12 14-8 7-17-13-10 6-9-5Z" fill="#fff" stroke="#8da0aa" strokeWidth="1.5"/>
        <path d="m91 73 18 7-4 6-17-5Z" fill={`url(#mm-blue-${kind})`}/>
      </g>}
    </svg>
  </span>;
}

export function PassengerSticker({size=44,className=''}:{size?:number;className?:string}){
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#e9fff2] to-[#e8f1ff] shadow-inner ${className}`} style={{width:size,height:size}}>
    <svg viewBox="0 0 48 48" width="82%" height="82%" fill="none">
      <circle cx="24" cy="14" r="7" fill="#d49a72"/><path d="M14 43q0-14 10-14t10 14" fill="#07985e"/><path d="m17 28 7 6 7-6" stroke="#fff" strokeWidth="2"/><path d="M17 42h14" stroke="#1246ad" strokeWidth="5" strokeLinecap="round"/>
    </svg>
  </span>;
}
