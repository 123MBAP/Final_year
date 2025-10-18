// intentionally empty declaration to avoid conflicting ambient declarations.
// The TypeScript wrapper `mqtt.ts` provides module exports for runtime use.
// Declaration for the JS socket relay (src/routes/mqtt.js)
export type MqttMessage = { topic: string; message: string }

export function onMqtt(fn: (data: MqttMessage) => void): () => void
export function sendControl(payload: any): void
export function sendSettings(payload: any): void
export const socket: any

declare const _default: { onMqtt: typeof onMqtt; sendControl: typeof sendControl; sendSettings: typeof sendSettings; socket: any }
export default _default

