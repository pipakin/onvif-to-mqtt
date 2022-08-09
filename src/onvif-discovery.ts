import onvif from "onvif";
import xml2js from 'xml2js';

const stripPrefix = xml2js.processors.stripPrefix;

export interface CameraData {
    address: string;
    name: string;
    hardware: string;
    xaddrs: string;
    urn: string;
    camObj?: any;
    stopTimeout?: any;
    invertVertical?: boolean;
    invertHorizontal?: boolean;
    deviceName?: string;
};

export function discoverCameras(networkInterfaces: string[]): Promise<CameraData[]> {
    const results: CameraData[] = [];

    onvif.Discovery.on('device', function (cam: any, rinfo: any, xml: any) {
        // Function will be called as soon as the NVT responses

        // Parsing of Discovery responses taken from my ONVIF-Audit project, part of the 2018 ONVIF Open Source Challenge
        // Filter out xml name spaces
        xml = xml.replace(/xmlns([^=]*?)=(".*?")/g, '');


        let parser = new xml2js.Parser({
            attrkey: 'attr',
            charkey: 'payload',                // this ensures the payload is called .payload regardless of whether the XML Tags have Attributes or not
            explicitCharkey: true,
            tagNameProcessors: [stripPrefix]   // strip namespace eg tt:Data -> Data
        });
        parser.parseString(xml,
            function (err: any, result: any) {
                if (err) return;
                let urn = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['EndpointReference'][0]['Address'][0].payload;
                let xaddrs = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['XAddrs'][0].payload;
                let scopes = result['Envelope']['Body'][0]['ProbeMatches'][0]['ProbeMatch'][0]['Scopes'][0].payload;
                scopes = scopes.split(" ");

                let hardware = "";
                let name = "";
                for (let i = 0; i < scopes.length; i++) {
                    if (scopes[i].includes('onvif://www.onvif.org/name')) name = decodeURI(scopes[i].substring(27));
                    if (scopes[i].includes('onvif://www.onvif.org/hardware')) hardware = decodeURI(scopes[i].substring(31));
                }
                results.push({
                    address: rinfo.address,
                    name,
                    hardware,
                    xaddrs,
                    urn
                });
            }
        );
    });

    const promises = networkInterfaces.map(i => new Promise((resolve, reject) => onvif.Discovery.probe({ device: i }, (err: any) => err ? reject(err) : resolve(null))));
    return Promise.all(promises).then(() => results);
}