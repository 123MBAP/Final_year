// Thin TypeScript wrapper around the JS socket relay (src/routes/mqtt.js)
// This file re-exports the runtime functions with types so TS and Vite resolution are happy.
import * as mqttJS from './mqtt.js';

export type MqttMessage = { topic: string; message: string }

export function onMqtt(fn: (data: MqttMessage) => void): () => void {
  // mqttJS.onMqtt returns an unsubscribe function
  // @ts-ignore - mqttJS is a JS module
  return mqttJS.onMqtt(fn)
}

export function sendControl(payload: any): void {
  // @ts-ignore
  mqttJS.sendControl(payload)
}

export function sendSettings(payload: any): void {
  // @ts-ignore
  mqttJS.sendSettings(payload)
}

// expose socket for connection events
// @ts-ignore
export const socket: any = mqttJS.socket

export default { onMqtt, sendControl, sendSettings, socket }
