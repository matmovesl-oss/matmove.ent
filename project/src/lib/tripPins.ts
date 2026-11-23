const validPoint=(point:any)=>point&&typeof point.lat==='number'&&Number.isFinite(point.lat)&&Math.abs(point.lat)<=90&&typeof point.lng==='number'&&Number.isFinite(point.lng)&&Math.abs(point.lng)<=180;

export function tripPinFields(pickup:[number,number],destination:[number,number]){
 if(!Array.isArray(pickup)||pickup.length!==2||!Array.isArray(destination)||destination.length!==2||!validPoint({lng:pickup[0],lat:pickup[1]})||!validPoint({lng:destination[0],lat:destination[1]}))throw Error('Confirm both map locations before requesting.');
 return{matmove_pickup_lat:pickup[1],matmove_pickup_lng:pickup[0],matmove_destination_lat:destination[1],matmove_destination_lng:destination[0]};
}
