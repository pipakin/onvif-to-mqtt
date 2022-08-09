import os from "os";
import mqtt from "async-mqtt";
import { CameraData, discoverCameras } from "./onvif-discovery";
import { MqttClient } from "mqtt";
import onvif from "onvif";
import {URL} from 'url';
import fs from "fs";
import _ from "lodash";

const osInterfaces = os.networkInterfaces();
const networkInterfaces = process.env.NETWORK_INTERFACES?.split(",") || Object.keys(osInterfaces).filter(x => osInterfaces[x]?.some(x => x.family === "IPv4"));
const mqttPrefix = process.env.MQTT_PREFIX || "onvif";
const mqttServer = process.env.MQTT_SERVER || "tcp://localhost:1883";

async function announce(cam: CameraData, client: MqttClient) {
	console.log("announcing camera on " + cam.xaddrs);
	const camMsg = JSON.stringify(cam);
	client.publish(`${mqttPrefix}/announce`, camMsg);
	client.publish(`${mqttPrefix}/${cam.urn}/announce`, camMsg);
	client.subscribe(`${mqttPrefix}/${cam.urn}/command`);
}

async function moveCam(cam: CameraData, x: number, y: number, timeout: number, user: string, pass: string): Promise<void> {
	if(cam.stopTimeout) {
		clearTimeout(cam.stopTimeout);
		delete cam.stopTimeout;
	}
	if(!cam.camObj) {
		cam.camObj = await new Promise((resolve) => {
			const url = new URL(cam.xaddrs);
			new onvif.Cam({
				hostname: url.hostname,
				port: url.port,
				timeout: 10000,
				username: user,
				password: pass
			}, function(err: any) {
				if(err) resolve(null);
				//@ts-ignore
				const result: any = this;
				resolve(result);
			});
		});

		if(!cam.camObj) return;
	} else {
		if(cam.camObj.username !== user || cam.camObj.password !== pass) {
			return;
		}
	}

	if(cam.invertVertical) y = -y;
	if(cam.invertHorizontal) x = -x;

	// Move the camera
	console.log('sending move command ' + x + ", " + y);
		

	function stop() {
		// send a stop command, stopping Pan/Tilt and stopping zoom
		console.log('sending stop command');
		cam.camObj.stop({panTilt: true},
			function(err: any){
				if (err) {
					console.log(err);
				} else {
					console.log('stop command sent');
				}
			});
	}

	cam.camObj.continuousMove({x, y} ,
	// completion callback function
	function(err: any) {
		if (err) {
			console.log(err);
		} else {
			console.log('move command sent ' + x + ", " + y);
			// schedule a Stop command to run in the future 
			cam.stopTimeout = setTimeout(stop, timeout);
		}
	});

}

async function startUp() {
	const client = await mqtt.connectAsync(mqttServer);

	async function doDiscovery() {
		const cams = await discoverCameras(networkInterfaces);
		cams.forEach(cam => announce(cam, client));
		JSON.parse(fs.readFileSync(process.env.CAM_DATA_PATH || "./cams.json", "utf8")).forEach((c: CameraData) => {
			const idx = cams.findIndex(x => x.urn === c.urn);
			if(idx > -1) {
				cams[idx] = {
					...c,
					...cams[idx]
				};
			} else {
				cams.push(c);
			}
		})
		fs.writeFileSync(process.env.CAM_DATA_PATH || "./cams.json", JSON.stringify(cams, null, 2));

		return cams;
	}

	let cams = await doDiscovery();

	//subscribe to announce command
	client.subscribe(`${mqttPrefix}/command`);

	client.on("message", (topic, payload) => {
		if(topic === `${mqttPrefix}/command`) {
			const command = JSON.parse(payload.toString());
			if(command.action === "announce" || command === "reload") {
				doDiscovery();
				return;
			}
		} else {
			const segments = topic.split("/");
			if(segments.length == 3 && segments[0] === mqttPrefix && segments[2] === "command") {
				const cam = cams.find(x => x.urn === segments[1]);
				if(cam) {
					const command = JSON.parse(payload.toString());
					switch(command.action) {
						case "announce":
							announce(cam, client);
							return;
						case "up":
							moveCam(cam, 0, 1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "down":
							moveCam(cam, 0, -1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "left":
							moveCam(cam, -1, 0, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "right":
							moveCam(cam, 1, 0, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "upleft":
							moveCam(cam, -1, 1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "upright":
							moveCam(cam, 1, 1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "downleft":
							moveCam(cam, -1, -1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;
						case "downright":
							moveCam(cam, 1, -1, command.timeout || 1000, command.user || process.env.DEFAULT_USER, command.password || process.env.DEFAULT_PASSWORD);
							return;

					}
				}
			}
		}
	})
}

startUp();

// async function listen() {
//     const client = await MQTT.connectAsync("tcp://10.93.1.160:1883");

//     logger.info("Subscribing to the announce channel...");
//     await client.subscribe("shellies/announce");

//     client.on('message', async function (topic, message) {
//         const values = JSON.parse(message.toString());
//         logger.silly("Message", values);

//         const {body: status} = await agent.get(`http://${values.ip}/status`);
//         logger.silly("Status", status);

//         const {body: settings} = await agent.get(`http://${values.ip}/settings`);
//         logger.silly("Settings", settings);

        

//     });

//     logger.info("Subscribed! Triggering re-announce...");
//     await client.publish("shellies/command", "announce");
// }