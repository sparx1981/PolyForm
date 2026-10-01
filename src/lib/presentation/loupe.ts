import * as THREE from 'three';
/** Crop the source camera frustum around a viewport point, without moving the source camera. */
export function configureLoupeCamera(source: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number, position: [
    number,
    number
], radius: number, magnification: number) {
    target.copy(source as any, false);
    source.getWorldPosition(target.position);
    source.getWorldQuaternion(target.quaternion);
    const view = source.view;
    const fullWidth = view?.enabled ? view.fullWidth : width;
    const fullHeight = view?.enabled ? view.fullHeight : height;
    const viewWidth = view?.enabled ? view.width : width;
    const viewHeight = view?.enabled ? view.height : height;
    const cropWidth = 2 * radius / Math.max(1, magnification) * viewWidth / width;
    const cropHeight = 2 * radius / Math.max(1, magnification) * viewHeight / height;
    target.setViewOffset(fullWidth, fullHeight, (view?.enabled ? view.offsetX : 0) + position[0] * viewWidth - cropWidth / 2, (view?.enabled ? view.offsetY : 0) + position[1] * viewHeight - cropHeight / 2, cropWidth, cropHeight);
    target.updateMatrixWorld();
}
export function createLoupeMaterial(texture: THREE.Texture) {
    return new THREE.ShaderMaterial({
        uniforms: { view: { value: texture } }, transparent: true, depthTest: false, depthWrite: false,
        vertexShader: `varying vec2 lensUv; void main(){lensUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `
      uniform sampler2D view; varying vec2 lensUv;
      void main(){
        vec2 p=(lensUv-.5)*2.;float r=length(p);
        if(r>1.) discard;
        vec3 colour=texture2D(view,lensUv).rgb;
        // Refraction is confined to the bevel; the magnified centre stays sharp and undistorted.
        float rim=smoothstep(.90,.94,r);
        vec2 bent=.5+p*.5*(1.-.045*sin(clamp((r-.9)*10.,0.,1.)*3.14159));
        vec3 glass=texture2D(view,bent).rgb;
        glass+=texture2D(view,bent+vec2(.003,0.)).rgb;
        glass+=texture2D(view,bent-vec2(.003,0.)).rgb;
        glass/=3.;
        float highlight=pow(max(0.,dot(p/max(r,.0001),normalize(vec2(-.6,.8)))),8.);
        colour=mix(colour,glass*.9+vec3(.12,.16,.18)+highlight*.45,rim);
        colour+=vec3(.3)*exp(-pow((r-.925)*180.,2.));
        gl_FragColor=vec4(colour,1.-smoothstep(.99,1.,r));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
}
