import { io } from 'socket.io-client'

// Connect to backend Socket.IO (assumes backend runs on same host:3001 in dev)
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'
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
