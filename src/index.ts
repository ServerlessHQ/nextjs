import { NextApiRequest, NextApiResponse } from "next";
import Client from "@serverlesshq/nodejs";
import ngrok from 'ngrok'

let baseCallbackUrl: string | undefined = undefined;
let sqToken: string = process.env.SHQ_TOKEN || ""
let callbackPort = process.env.SHQ_CALLBACK_PORT || 3000

if (process.env.VERCEL_URL) {
  baseCallbackUrl = `https://${process.env.VERCEL_URL}/api/`;
}

if (process.env.SHQ_BASE_CALLBACK_URL) {
  baseCallbackUrl = `${process.env.SHQ_BASE_CALLBACK_URL}/api/`;
}

if (!baseCallbackUrl) {
  if (process.env.NODE_ENV === "production") {
    console.error("No SHQ_BASE_CALLBACK_URL specified, this is a REQUIRED variable");
  } else if(process.env.NODE_ENV === "development") {
    ngrok.connect({proto: 'http', addr: callbackPort}).then((url) => {
      baseCallbackUrl = `${url}/api/`
    })
  }
}

const waitForNgrok = async () => {
  return new Promise<void>(async (resolve, reject) => {
    const interval = setInterval(() => {
      if(baseCallbackUrl){
        clearInterval(interval)
        resolve()
      }
    }, 250)
  })
}

export type HandlerFunc = (job: Record<any,any>) => Promise<void>

export function BackgroundFunction(name: string, path: string, handler: HandlerFunc) {
    const client = new Client(sqToken)

    async function nextApiHandler(req: NextApiRequest, res: NextApiResponse) {
        const webhookSignature = req.headers['shq-webhook-signature'] as string
        const payload = req.body
        const jobPayload = client.verifyAndDecrypt(payload, webhookSignature)
        if(!jobPayload) {
          res.status(200).json("{error: 'invalid signature'}")
          return
        }

        try {
          await handler(jobPayload)
          res.status(200).end()
        } catch (error) {
          await client.nack({ functionName: name, payload, error: error.toString(), headers: req.headers })
          res.status(500).json(`{error: '${error.toString()}'}`)
        }
    }

    nextApiHandler.enqueue = async (payloadJSON: Record<any, any>) => {
        if(!baseCallbackUrl) {
          await waitForNgrok()
        }
        return await client.enqueue({ functionName: name, payloadJSON, callbackUrl: `${baseCallbackUrl}${path}` })
    }
    return nextApiHandler
}

export function ScheduledTask(path: string, handler: HandlerFunc) {
  const client = new Client(sqToken)

  async function nextApiHandler(req: NextApiRequest, res: NextApiResponse) {
      const webhookSignature = req.headers['shq-webhook-signature'] as string
      const payload = req.body
      const jobPayload = client.verifyAndDecrypt(payload, webhookSignature)
      if(!jobPayload) {
        res.status(200).json("{error: 'invalid signature'}")
        return
      }

      try {
        await handler(jobPayload)
        res.status(200).end()
      } catch (error) {
        await client.nackScheduledTask({ path: path, error: error.toString() })
        res.status(500).json(`{error: '${error.toString()}'}`)
      }
  }
  return nextApiHandler
}