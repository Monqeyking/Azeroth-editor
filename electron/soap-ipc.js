const http = require('http');

let soapRequestId = 0;

function decodeSoapText(value) {
  return String(value ?? '')
    .replace(/&amp;#(x[0-9a-f]+|[0-9]+);/gi, '&#$1;')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function registerSoapIpc(ipcMain) {
  ipcMain.handle('soap:command', async (_, { host, port, user, password, command }) => {
    return new Promise((resolve) => {
      const requestId = ++soapRequestId;
      const soapCommand = String(command ?? '').trim();
      const auth = Buffer.from(`${user}:${password}`).toString('base64');

      function escapeXml(value) {
        return value
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
      }

      function sendSoapCommand(attemptCommand, attempt) {
        const escapedCommand = escapeXml(attemptCommand);
        const body = `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:AC">
  <SOAP-ENV:Body>
    <ns1:executeCommand><command>${escapedCommand}</command></ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

        console.log(`[SOAP ${requestId}.${attempt}] target:`, `${host}:${port}`, 'user:', user || '(empty)');
        console.log(`[SOAP ${requestId}.${attempt}] raw command:`, JSON.stringify(command));
        console.log(`[SOAP ${requestId}.${attempt}] command:`, attemptCommand);
        console.log(`[SOAP ${requestId}.${attempt}] command length:`, attemptCommand.length);
        console.log(`[SOAP ${requestId}.${attempt}] command chars:`, [...attemptCommand].map(ch => `${ch}:${ch.charCodeAt(0)}`).join(' '));
        console.log(`[SOAP ${requestId}.${attempt}] request body:`, body);

        const req = http.request({
          hostname: host,
          port: Number(port),
          path: '/RPC2',
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml;charset=UTF-8',
            'SOAPAction': 'urn:AC#executeCommand',
            'Authorization': `Basic ${auth}`,
            'Content-Length': Buffer.byteLength(body),
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            console.log(`[SOAP ${requestId}.${attempt}] status:`, res.statusCode);
            console.log(`[SOAP ${requestId}.${attempt}] response:`, data);
            const result = data.match(/<result>([\s\S]*?)<\/result>/);
            const fault  = data.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
            const parsedResult = result ? decodeSoapText(result[1]) : null;
            const parsedFault = fault ? decodeSoapText(fault[1]) : null;
            if (parsedResult) console.log(`[SOAP ${requestId}.${attempt}] parsed result:`, parsedResult);
            if (parsedFault) console.log(`[SOAP ${requestId}.${attempt}] parsed fault:`, parsedFault);

            const shouldRetryWithoutDot =
              attempt === 1 &&
              attemptCommand.startsWith('.go ') &&
              parsedFault?.includes('.gobject');
            if (shouldRetryWithoutDot) {
              const retryCommand = attemptCommand.slice(1);
              console.log(`[SOAP ${requestId}.${attempt}] .go matched .gobject; retrying as:`, retryCommand);
              sendSoapCommand(retryCommand, attempt + 1);
              return;
            }

            if (res.statusCode === 200) {
              resolve({ success: true, result: parsedResult ?? 'OK' });
            } else {
              const msg = parsedFault ?? parsedResult ?? data;
              resolve({ success: false, error: `HTTP ${res.statusCode}: ${msg}` });
            }
          });
        });

        req.on('error', (e) => {
          console.log(`[SOAP ${requestId}.${attempt}] request error:`, e.message);
          resolve({ success: false, error: e.message });
        });
        req.write(body);
        req.end();
      }

      sendSoapCommand(soapCommand, 1);
    });
  });
}

module.exports = { decodeSoapText, registerSoapIpc };
