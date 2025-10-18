import express from 'express'
import http from 'http'
import mqtt from 'mqtt'
import path from 'path'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const server = http.createServer(app)
const io = new Server(server, { cors: { origin: '*' } })

// Configuration via env vars
const MQTT_URL = process.env.MQTT_URL || 'mqtt://test.mosquitto.org:1883'
// Match MicroPython main.py topics which use 'machine/...' by default
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'machine'

// Serve Vite build for production
app.use(express.static(path.join(__dirname, 'dist')))

// Basic health and status endpoints useful for Render or other platforms
let mqttConnected = false
let lastMqtt = { topic: null, message: null, time: null }
let lastControl = { data: null, time: null, socketId: null }

app.get('/healthz', (req, res) => {
  // return ok if server running; include mqtt state for readiness
  res.json({ ok: true, mqtt: mqttConnected })
})

app.get('/status', (req, res) => {
  res.json({
    ok: true,
    mqtt: { connected: mqttConnected, last: lastMqtt },
    topicPrefix: MQTT_TOPIC_PREFIX,
    lastControl,
    now: new Date().toISOString()
  })
})

// SPA fallback - serve index.html for all non-API routes
// Use a catch-all middleware to avoid path-to-regexp parsing errors
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

// Connect to MQTT broker
const mqttClient = mqtt.connect(MQTT_URL)

mqttClient.on('connect', () => {
  mqttConnected = true
  console.log('Connected to MQTT broker', MQTT_URL)
  // subscribe to motor topics
  mqttClient.subscribe(`${MQTT_TOPIC_PREFIX}/#`, (err) => {
    if(err) console.error('MQTT subscribe error', err)
  })
})

mqttClient.on('error', (err)=>{
  mqttConnected = false
  console.error('MQTT error', err)
})

// When MQTT messages arrive, relay to socket.io clients
mqttClient.on('message', (topic, payload)=>{
  try{
    const msg = payload.toString()
    lastMqtt = { topic, message: msg, time: new Date().toISOString() }
    // topic like motor/temp or motor/state
    io.emit('mqtt', { topic, message: msg })
  }catch(e){ console.error('mqtt message parse error', e) }
})

io.on('connection', (socket)=>{
  console.log('client connected', socket.id)

  // forward incoming control messages from client to MQTT
  socket.on('control', (data)=>{
    console.log('control from', socket.id, data)
    try{
      lastControl = { data, time: new Date().toISOString(), socketId: socket.id }
    }catch(e){ }
    // data: could be a raw command string like 'start' or a structured object
    // Publish to machine/command to match the device's expectations
    const topic = `${MQTT_TOPIC_PREFIX}/command`
    try{
      if(typeof data === 'string'){
        mqttClient.publish(topic, data)
      } else if (data && typeof data === 'object' && data.cmd){
        // send structured command as compact JSON (device expects JSON payloads for complex commands)
        mqttClient.publish(topic, JSON.stringify(data))
      } else {
        // fallback: publish the payload as JSON
        mqttClient.publish(topic, JSON.stringify(data))
      }
    }catch(e){ console.error('publish control err', e) }
  })

  socket.on('settings', (data)=>{
    const topic = `${MQTT_TOPIC_PREFIX}/settings`
    mqttClient.publish(topic, JSON.stringify(data))
  })

  // Handle temperature data from simulator
  socket.on('temperature', (data)=>{
    const topic = `${MQTT_TOPIC_PREFIX}/temp`
    mqttClient.publish(topic, JSON.stringify(data))
  })

  // Handle state data from simulator
  socket.on('state', (data)=>{
    const topic = `${MQTT_TOPIC_PREFIX}/state`
    mqttClient.publish(topic, JSON.stringify(data))
  })

  socket.on('disconnect', ()=>{
    console.log('client disconnected', socket.id)
  })
})

const PORT = process.env.PORT || 3001
server.listen(PORT, ()=> console.log(`Server listening on ${PORT}, MQTT -> ${MQTT_URL}`))
