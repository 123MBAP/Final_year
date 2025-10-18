import { io } from 'socket.io-client'

// Connect to backend Socket.IO.
// Prefer VITE_SERVER_URL (baked at build time). If not provided, fall back to the
// runtime page origin so the frontend served by the same server connects back to it
// (this avoids needing to rebuild with VITE_SERVER_URL when deploying the single Docker image).
const runtimeOrigin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : undefined
const SERVER_URL = import.meta.env.VITE_SERVER_URL || runtimeOrigin || 'http://localhost:3001'
const socket = io(SERVER_URL)

const listeners = {
  mqtt: [],
}

socket.on('connect', ()=> console.log('socket connected', socket.id))
socket.on('disconnect', ()=> console.log('socket disconnected'))

socket.on('mqtt', (data)=>{
  // data: { topic, message }
  listeners.mqtt.forEach(fn => fn(data))
})

export function onMqtt(fn){
  listeners.mqtt.push(fn)
  return ()=> { listeners.mqtt = listeners.mqtt.filter(f=>f!==fn) }
}

export function sendControl(payload){
  socket.emit('control', payload)
}

export function sendSettings(payload){
  socket.emit('settings', payload)
}

// Export socket for motor simulator
export { socket }

export default { onMqtt, sendControl, sendSettings, socket }
