import * as THREE from 'three';

export interface SurfaceForcing { speed: number; direction: [number, number]; turbulence: number; wind?: [number, number] }
const GRAVITY = 9.81;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const smooth = (lo: number, hi: number, x: number) => { const t = clamp((x-lo)/(hi-lo), 0, 1); return t*t*(3-2*t); };

/**
 * Linearised shallow-water waves on a staggered grid: gravity accelerates face velocities,
 * and divergence of depth-weighted flux changes surface height. Prescribed current advects
 * waves and foam. Closed wet/dry faces reflect waves; CFL substeps keep mobile frames stable.
 * This is a heightfield approximation, not a volumetric breaking-water/spray solver.
 * See https://www.cs.ubc.ca/~rbridson/fluidsimulation/fluids_notes.pdf (heightfield chapter).
 */
export class ShallowWaterWaves {
  readonly size: number;
  readonly heights: Float32Array;
  readonly foam: Float32Array;
  readonly texture: THREE.DataTexture;
  readonly bounds: THREE.Vector4;
  private depth: Float32Array;
  private u: Float32Array;
  private v: Float32Array;
  private advected: Float32Array;
  private advU: Float32Array;
  private advV: Float32Array;
  private pressure: Float32Array;
  private advFoam: Float32Array;
  private pixels: Float32Array;
  private dx: number;
  private dz: number;
  private time = 0;
  private pending = 0;
  private maxDepth = 0;

  constructor(bounds: [number, number, number, number], depthAt: (x: number, z: number) => number, size = 40) {
    // Keep cell width practical for tiny/narrow ponds so CFL substeps stay affordable.
    size=Math.min(size,Math.max(8,Math.floor(Math.min(bounds[2],bounds[3])/0.12)));
    this.size = size;
    this.bounds = new THREE.Vector4(...bounds);
    this.dx = bounds[2]/size; this.dz = bounds[3]/size;
    this.heights = new Float32Array(size*size);
    this.foam = new Float32Array(size*size);
    this.depth = new Float32Array(size*size);
    this.advected = new Float32Array(size*size);
    this.pressure = new Float32Array(size*size);
    this.advFoam = new Float32Array(size*size);
    this.u = new Float32Array((size+1)*size); this.advU = new Float32Array(this.u.length);
    this.v = new Float32Array(size*(size+1)); this.advV = new Float32Array(this.v.length);
    for (let z=0; z<size; z++) for (let x=0; x<size; x++) {
      const d = clamp(depthAt(bounds[0]+(x+.5)*this.dx, bounds[1]+(z+.5)*this.dz), 0, 6);
      this.depth[z*size+x] = d < 0.02 ? 0 : d;
      this.maxDepth = Math.max(this.maxDepth, d);
    }
    this.pixels = new Float32Array(size*size*4);
    this.texture = new THREE.DataTexture(this.pixels, size, size, THREE.RGBAFormat, THREE.FloatType);
    // Manual bilinear shader sampling avoids reliance on float-linear filtering on phones.
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  private sample(a: Float32Array, width: number, height: number, x: number, z: number): number {
    x=clamp(x, 0, width-1); z=clamp(z, 0, height-1);
    const ix=Math.floor(x), iz=Math.floor(z), jx=Math.min(ix+1,width-1), jz=Math.min(iz+1,height-1);
    const fx=x-ix, fz=z-iz;
    return (a[iz*width+ix]*(1-fx)+a[iz*width+jx]*fx)*(1-fz)
      +(a[jz*width+ix]*(1-fx)+a[jz*width+jx]*fx)*fz;
  }

  update(delta: number, input: SurfaceForcing): void {
    this.pending += clamp(delta, 0, 0.1);
    if (this.pending < 1/30 || this.maxDepth === 0) return;
    const elapsed = this.pending; this.pending=0;
    if (this.time===0 && input.speed<=0 && !Math.hypot(...(input.wind ?? [0,0])) && this.heights.every(h=>h===0)) return;
    const n=this.size, speed=clamp(input.speed,0,4), turbulence=clamp(input.turbulence,0,1);
    const length=Math.hypot(...input.direction) || 1;
    const cx=input.direction[0]/length*speed, cz=input.direction[1]/length*speed;
    const windX=input.wind?.[0] ?? 0, windZ=input.wind?.[1] ?? 0;
    const windSpeed=Math.min(25,Math.hypot(windX,windZ));
    const wx=windX/(Math.hypot(windX,windZ)||1), wz=windZ/(Math.hypot(windX,windZ)||1);
    // Fetch-limited wind pressure, with a finite-depth dispersion relation per cell.
    const fetch=Math.min(this.bounds.z,this.bounds.w);
    const windAmplitude=Math.min(.18,windSpeed*windSpeed*.0007)*smooth(1,12,fetch);
    const windK=2*Math.PI/Math.max(Math.max(this.dx,this.dz)*5,Math.min(8,1+windSpeed*.25));
    const safeDt=0.35*Math.min(this.dx,this.dz)/(Math.sqrt(GRAVITY*this.maxDepth)+speed+1e-3);
    const steps=Math.max(1,Math.ceil(elapsed/safeDt)), dt=elapsed/steps;
    for (let step=0; step<steps; step++) {
      this.time+=dt;
      const bx=cx*dt/this.dx, bz=cz*dt/this.dz;
      const amplitude=0.09*turbulence*turbulence*smooth(0.05,1.5,speed);
      const wavelength=Math.max(1.2,Math.max(this.dx,this.dz)*5);
      const k=2*Math.PI/wavelength;
      let total=0, wet=0;
      for (let z=0;z<n;z++) for (let x=0;x<n;x++) {
        const i=z*n+x;
        if (!this.depth[i]) { this.advected[i]=this.pressure[i]=this.advFoam[i]=0; continue; }
        this.advected[i]=this.sample(this.heights,n,n,x-bx,z-bz);
        this.advFoam[i]=this.sample(this.foam,n,n,x-bx,z-bz)*Math.exp(-dt/0.85);
        const px=(x+.5)*this.dx-cx*this.time, pz=(z+.5)*this.dz-cz*this.time;
        // A changing pressure field supplies small-scale energy; the solver propagates it.
        const stirring=amplitude*(Math.sin(k*px+0.7*Math.sin(k*pz-this.time*1.7))
          +.45*Math.sin(k*pz*1.3+this.time*2.1));
        const omega=Math.sqrt(GRAVITY*windK*Math.tanh(windK*this.depth[i]));
        const phase=windK*((x+.5)*this.dx*wx+(z+.5)*this.dz*wz)-omega*this.time;
        const windPressure=windAmplitude*(Math.sin(phase)+.28*Math.sin(phase*1.7+.8));
        this.pressure[i]=this.advected[i]+stirring+windPressure;
        total+=this.advected[i]; wet++;
      }
      // Semi-Lagrangian transport diffuses some volume at irregular banks. Correct its mean.
      let previousTotal=0; for (let i=0;i<this.heights.length;i++) previousTotal+=this.heights[i];
      const correction=(total-previousTotal)/Math.max(wet,1);
      for (let i=0;i<this.heights.length;i++) if(this.depth[i]) { this.advected[i]-=correction; this.pressure[i]-=correction; }
      for(let z=0;z<n;z++) for(let x=0;x<=n;x++) this.advU[z*(n+1)+x]=this.sample(this.u,n+1,n,x-bx,z-bz);
      for(let z=0;z<=n;z++) for(let x=0;x<n;x++) this.advV[z*n+x]=this.sample(this.v,n,n+1,x-bx,z-bz);
      const damping=Math.exp(-dt*1.2);
      for(let z=0;z<n;z++) for(let x=0;x<=n;x++) {
        const f=z*(n+1)+x, left=z*n+x-1, right=z*n+x;
        this.u[f] = x===0 || x===n || !this.depth[left] || !this.depth[right] ? 0
          : (this.advU[f]-GRAVITY*dt*(this.pressure[right]-this.pressure[left])/this.dx)*damping;
      }
      for(let z=0;z<=n;z++) for(let x=0;x<n;x++) {
        const f=z*n+x, back=(z-1)*n+x, front=z*n+x;
        this.v[f] = z===0 || z===n || !this.depth[back] || !this.depth[front] ? 0
          : (this.advV[f]-GRAVITY*dt*(this.pressure[front]-this.pressure[back])/this.dz)*damping;
      }
      for(let z=0;z<n;z++) for(let x=0;x<n;x++) {
        const i=z*n+x, d=this.depth[i]; if(!d) continue;
        const fluxX=this.u[z*(n+1)+x+1]*Math.min(d,this.depth[i+1]??0)-this.u[z*(n+1)+x]*Math.min(d,this.depth[i-1]??0);
        const fluxZ=this.v[(z+1)*n+x]*Math.min(d,this.depth[i+n]??0)-this.v[z*n+x]*Math.min(d,this.depth[i-n]??0);
        this.heights[i]=clamp(this.advected[i]-dt*(fluxX/this.dx+fluxZ/this.dz), -d*.22, d*.22);
        this.foam[i]=this.advFoam[i];
      }
    }
    for(let z=0;z<n;z++) for(let x=0;x<n;x++) {
      const i=z*n+x, h=this.heights[i], d=this.depth[i];
      const neighbor=(xx:number,zz:number)=>xx<0||zz<0||xx>=n||zz>=n||!this.depth[zz*n+xx] ? h : this.heights[zz*n+xx];
      const sx=(neighbor(x+1,z)-neighbor(x-1,z))/(2*this.dx);
      const sz=(neighbor(x,z+1)-neighbor(x,z-1))/(2*this.dz);
      const steepness=Math.hypot(sx,sz), froude=speed/Math.sqrt(GRAVITY*Math.max(d,.05));
      // Whitecaps are an aeration closure: steep positive crests plus fast shallow currents.
      const breaking=smooth(.10,.32,steepness)*smooth(.025,.12,h);
      const rapids=smooth(.6,1.2,froude)*smooth(.06,.24,steepness);
      const convergence=Math.max(0,-((this.u[z*(n+1)+x+1]-this.u[z*(n+1)+x])/this.dx
        +(this.v[(z+1)*n+x]-this.v[z*n+x])/this.dz));
      const compression=smooth(.3,2,convergence)*smooth(.04,.18,h/Math.max(d,.05));
      const energy=Math.max(smooth(.25,.85,turbulence)*smooth(.1,.8,speed),smooth(7,16,windSpeed));
      const source=Math.max(breaking,rapids,compression)*energy;
      this.foam[i]=d ? Math.max(this.foam[i],source) : 0;
      this.pixels[i*4]=h; this.pixels[i*4+1]=sx; this.pixels[i*4+2]=sz; this.pixels[i*4+3]=this.foam[i];
    }
    this.texture.needsUpdate=true;
  }
  dispose(): void { this.texture.dispose(); }
}
