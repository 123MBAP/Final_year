Deploying to Render

This repo is set up to run as a single Docker image: the Vite frontend is built during the Docker build and the Node `server.js` serves `dist/` and acts as the MQTT/socket relay.

Recommended environment variables on Render (Service -> Environment):

- PORT=3001 (Render will override PORT automatically, but set a default)
- MQTT_URL=mqtt://your-broker:1883 (optional, default: mqtt://test.mosquitto.org:1883)
- MQTT_TOPIC_PREFIX=machine (optional default: machine)
- VITE_SERVER_URL=https://your-service.example.com (optional, used by frontend socket client)

Steps (Render web service using Docker):

1. Push this repo to GitHub if it's not already there.
2. In Render dashboard, click "New" -> "Web Service".
3. Connect your GitHub repo and select the branch (e.g., `main`).
4. For Environment choose "Docker".
5. Set Build command: leave blank (Dockerfile will handle build).
6. Set Start command: leave blank (CMD in Dockerfile runs `node server.js`).
7. Add the environment variables above.
8. Create the service; Render will build the Docker image and deploy.

Notes
- If your frontend needs to connect back to this server for socket.io, set `VITE_SERVER_URL` to the public Render URL (for example `https://<your-service>.onrender.com`).
- For TLS and custom domains, configure them in Render's dashboard under the service settings.
- If you prefer not to use Docker, you can instead use Render's Node environment and set the build and start commands:
  - Build command: `npm ci && npm run build`
  - Start command: `node server.js`

Troubleshooting
- Check Render build logs for npm install or build errors.
- Ensure the MQTT broker is reachable from Render (public broker or your hosted broker) and `MQTT_URL` includes the correct protocol and port.
- If socket.io can't connect from the browser to the server, verify `VITE_SERVER_URL` is set and the frontend has the correct value.
