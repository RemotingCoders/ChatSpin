export type PanelPosition={x:number;y:number};
export type PanelBounds={width:number;height:number;viewportWidth:number;viewportHeight:number};
const finite=(n:number)=>Number.isFinite(n)?n:0;
export function fitPanel(position:PanelPosition,bounds:PanelBounds):PanelPosition{
 const maxX=Math.max(0,bounds.viewportWidth-bounds.width),maxY=Math.max(0,bounds.viewportHeight-bounds.height);
 return {x:Math.min(maxX,Math.max(0,finite(position.x))),y:Math.min(maxY,Math.max(0,finite(position.y)))};
}
export function restorePanel(saved:unknown,bounds:PanelBounds):PanelPosition{
 const value=saved as Partial<PanelPosition>|null;
 const x=typeof value?.x==='number'&&Number.isFinite(value.x)?value.x:1;
 const y=typeof value?.y==='number'&&Number.isFinite(value.y)?value.y:0;
 return fitPanel({x:x*Math.max(0,bounds.viewportWidth-bounds.width),y:y*Math.max(0,bounds.viewportHeight-bounds.height)},bounds);
}
export function rememberPanel(position:PanelPosition,bounds:PanelBounds):PanelPosition{
 const fitted=fitPanel(position,bounds),maxX=bounds.viewportWidth-bounds.width,maxY=bounds.viewportHeight-bounds.height;
 return {x:maxX>0?fitted.x/maxX:1,y:maxY>0?fitted.y/maxY:0};
}
