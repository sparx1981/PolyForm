import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { freezeQualityScene, qualityCapture } from '../../lib/presentation/qualitySnapshot';
export default function QualityCaptureBridge() {
    const { scene, camera, gl } = useThree();
    useEffect(() => {
        const capture = () => freezeQualityScene(scene, camera, gl.domElement.toDataURL('image/png'));
        qualityCapture.current = capture;
        return () => { if (qualityCapture.current === capture)
            qualityCapture.current = null; };
    }, [scene, camera, gl]);
    return null;
}
