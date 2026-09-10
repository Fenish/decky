import type { ConnectionAnimationPhase } from "./disconnected-screen";
import fallback from "../../assets/decky-studio-fallback.png";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Fixed camera and studio lighting for the approved disconnected composition.
 * Rendering is demand-driven: no idle animation loop and no mechanical transforms.
 */
interface ModelProps {
    connected: boolean;
    reducedMotion: boolean;
    onEntered: () => void;
    onPhase: (phase: ConnectionAnimationPhase) => void;
}
export function DisconnectedModel({ connected, reducedMotion, onEntered, onPhase }: ModelProps) {
    const latest = useRef({ connected, reducedMotion, onEntered, onPhase });
    const controller = useRef<{ enter: () => void; reset: () => void } | null>(null);
    useEffect(() => {
        latest.current = { connected, reducedMotion, onEntered, onPhase };
        if (connected) controller.current?.enter();
        else controller.current?.reset();
    }, [connected, reducedMotion, onEntered, onPhase]);
    const host = useRef<HTMLDivElement>(null);
    const [ready, setReady] = useState(false);
    useEffect(() => {
        const element = host.current;
        if (!element) return;
        let renderer: THREE.WebGLRenderer;
        try {
            renderer = new THREE.WebGLRenderer({
                antialias: true,
                alpha: true,
                powerPreference: "low-power",
                preserveDrawingBuffer: true,
            });
        } catch {
            controller.current = { enter: () => latest.current.onEntered(), reset: () => {} };
            if (latest.current.connected) latest.current.onEntered();
            return () => {
                controller.current = null;
            };
        }
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        element.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(22, 1.5, 0.005, 60);
        camera.up.set(0, 0, 1);
        camera.position.set(3, -7.5, 7.5);
        camera.lookAt(0, 0, 0);
        const pmrem = new THREE.PMREMGenerator(renderer);
        const studio = new THREE.Scene();
        studio.background = new THREE.Color(0x101010);
        for (const [x, y, z, w, h, power] of [
            [-4, -2, 7, 7, 5, 2],
            [6, 2, 2, 1, 7, 5],
            [0, 6, 7, 5, 2, 0.8],
        ]) {
            const card = new THREE.Mesh(
                new THREE.PlaneGeometry(w, h),
                new THREE.MeshBasicMaterial({
                    color: new THREE.Color(1, 0.985, 0.955).multiplyScalar(power!),
                }),
            );
            card.position.set(x!, y!, z!);
            card.lookAt(0, 0, 0);
            studio.add(card);
        }
        const environment = pmrem.fromScene(studio, 0.025);
        scene.environment = environment.texture;
        scene.environmentIntensity = 0.8;
        disposeObject(studio);
        pmrem.dispose();
        scene.add(new THREE.HemisphereLight(0xfaf6ef, 0x090909, 0.25));
        // Broad soft upper-left key, pale right edge, almost no frontal fill.
        RectAreaLightUniformsLib.init();
        const key = new THREE.RectAreaLight(0xfff8ee, 8, 6, 5);
        key.position.set(-2, -1, 6);
        key.lookAt(0, 0, 0);
        scene.add(key);
        const rim = new THREE.RectAreaLight(0xfffaf4, 16, 1, 7);
        rim.position.set(5, 2, 1.5);
        rim.lookAt(0, 0, 0);
        scene.add(rim);
        const edge = new THREE.DirectionalLight(0xfff8ea, 8);
        edge.position.set(8, 2, 0.7);
        scene.add(edge);
        const fill = new THREE.DirectionalLight(0xffffff, 0.15);
        fill.position.set(0, -5, 1);
        scene.add(fill);
        const assembly = new THREE.Group();
        scene.add(assembly);
        let disposed = false;
        let modelReady = false;
        let animationFrame = 0;
        let animating = false;
        let animationComplete = false;
        const startPosition = camera.position.clone();
        const startQuaternion = camera.quaternion.clone();
        const destination = new THREE.Vector3(0, 0, 0.22);
        const frontPosition = new THREE.Vector3(0, 0, 11);
        const frontCamera = new THREE.PerspectiveCamera();
        frontCamera.position.copy(frontPosition);
        frontCamera.up.set(0, 1, 0);
        frontCamera.lookAt(destination);
        const frontQuaternion = frontCamera.quaternion.clone();
        const ease = (t: number): number =>
            t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const render = (): void => {
            const { width, height } = element.getBoundingClientRect();
            if (disposed || width < 1 || height < 1) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
        };
        const finish = (): void => {
            if (disposed || !latest.current.connected) return;
            animating = false;
            animationComplete = true;
            latest.current.onEntered();
        };
        const reset = (): void => {
            cancelAnimationFrame(animationFrame);
            animating = false;
            animationComplete = false;
            camera.position.copy(startPosition);
            camera.quaternion.copy(startQuaternion);
            latest.current.onPhase("waiting");
            render();
        };
        const enter = (): void => {
            if (!modelReady || animating || animationComplete || disposed) return;
            if (
                latest.current.reducedMotion ||
                matchMedia("(prefers-reduced-motion: reduce)").matches
            ) {
                finish();
                return;
            }
            animating = true;
            latest.current.onPhase("rotating");
            const started = performance.now();
            let zoomStarted = false;
            const tick = (now: number): void => {
                if (disposed || !latest.current.connected) {
                    reset();
                    return;
                }
                const elapsed = now - started;
                if (elapsed < 800) {
                    const t = ease(Math.min(1, elapsed / 800));
                    camera.position.lerpVectors(startPosition, frontPosition, t);
                    camera.quaternion.copy(startQuaternion).slerp(frontQuaternion, t);
                } else {
                    if (!zoomStarted) {
                        zoomStarted = true;
                        latest.current.onPhase("zooming");
                    }
                    const t = ease(Math.min(1, (elapsed - 800) / 1050));
                    camera.position.lerpVectors(
                        frontPosition,
                        destination.clone().add(new THREE.Vector3(0, 0, 0.06)),
                        t,
                    );
                    camera.quaternion.copy(frontQuaternion);
                }
                render();
                if (elapsed >= 1850) {
                    finish();
                    return;
                }
                animationFrame = requestAnimationFrame(tick);
            };
            animationFrame = requestAnimationFrame(tick);
        };
        controller.current = { enter, reset };
        const loadDeadline = setTimeout(() => {
            if (!modelReady) {
                controller.current = { enter: () => latest.current.onEntered(), reset: () => {} };
                if (latest.current.connected) latest.current.onEntered();
            }
        }, 6000);
        // Made from the CAD export by scripts/convert-model.mjs.
        new GLTFLoader().load(
            new URL("./models/decky.glb", document.baseURI).href,
            ({ scene: object }) => {
                if (disposed) {
                    disposeObject(object);
                    return;
                }
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                object.position.sub(center);
                assembly.scale.setScalar(4.5 / Math.max(size.x, size.y, size.z));
                // The loader rewrites names ("Touch_Glass"); userData.name keeps the CAD body's.
                const cad = (child: THREE.Object3D): string => child.userData.name ?? "";
                object.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    const old = Array.isArray(child.material) ? child.material : [child.material];
                    old.forEach((material) => material.dispose());
                    const glass = /touch glass/i.test(cad(child));
                    const cover = /top cover/i.test(cad(child));
                    child.material = glass
                        ? new THREE.MeshBasicMaterial({ color: 0x000000 })
                        : new THREE.MeshStandardMaterial({
                              color: cover ? 0x333333 : 0x202020,
                              metalness: cover ? 0.4 : 0.3,
                              roughness: cover ? 0.34 : 0.4,
                              side: THREE.DoubleSide,
                          });
                });
                assembly.add(object);
                // The camera target is on the original glass, safely inside its center aperture.
                const glassMesh = object.children.find((child) => /touch glass/i.test(cad(child)));
                if (glassMesh instanceof THREE.Mesh) {
                    glassMesh.geometry.computeBoundingBox();
                    destination.z =
                        (glassMesh.geometry.boundingBox!.max.z - center.z) * assembly.scale.x;
                }
                clearTimeout(loadDeadline);
                modelReady = true;
                render();
                setReady(true);
                if (latest.current.connected) enter();
            },
            undefined,
            () => {
                clearTimeout(loadDeadline);
                controller.current = { enter: () => latest.current.onEntered(), reset: () => {} };
                if (latest.current.connected) latest.current.onEntered();
            },
        );
        const resize = new ResizeObserver(() => {
            if (!animating) render();
        });
        resize.observe(element);
        const restored = (): void => render();
        renderer.domElement.addEventListener("webglcontextrestored", restored);
        return () => {
            disposed = true;
            controller.current = null;
            clearTimeout(loadDeadline);
            cancelAnimationFrame(animationFrame);
            resize.disconnect();
            renderer.domElement.removeEventListener("webglcontextrestored", restored);
            disposeObject(scene);
            environment.dispose();
            renderer.dispose();
            renderer.domElement.remove();
        };
    }, []);
    return (
        <div
            ref={host}
            className={`disconnected-model ${ready ? "ready" : ""}`}
            role="img"
            aria-label="Your Decky enclosure"
            data-ready={ready}
        >
            <img className="disconnected-model-fallback" src={fallback} alt="" />
        </div>
    );
}
function disposeObject(object: THREE.Object3D): void {
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach((material: THREE.Material) => material.dispose());
        }
    });
}
