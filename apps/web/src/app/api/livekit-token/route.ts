import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

interface TokenRequestBody {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
}

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
};

function generateLiveKitJwt(
  apiKey: string,
  apiSecret: string,
  roomName: string,
  identity: string,
  name?: string
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: apiKey,
    sub: identity,
    jti: identity,
    name: name || identity,
    nbf: now,
    exp: now + 14400, // 4 hours TTL
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    },
  };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

export async function POST(req: Request) {
  try {
    let body: TokenRequestBody;
    try {
      body = await req.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Missing or invalid JSON body');
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON or missing request body.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (
      (body.roomName !== undefined && typeof body.roomName !== 'string') ||
      (body.participantIdentity !== undefined && typeof body.participantIdentity !== 'string') ||
      (body.participantName !== undefined &&
        body.participantName !== null &&
        typeof body.participantName !== 'string')
    ) {
      return NextResponse.json(
        { error: 'Invalid parameter types: roomName and participantIdentity must be strings.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const roomName = body.roomName?.trim();
    const participantIdentity = body.participantIdentity?.trim();
    const participantName = body.participantName?.trim();

    if (!roomName || !participantIdentity) {
      return NextResponse.json(
        { error: "Missing required parameters: 'roomName' and 'participantIdentity' are required." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    if (roomName.length > 256 || participantIdentity.length > 256) {
      return NextResponse.json(
        { error: 'Parameter length exceeds 256 characters.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl =
      process.env.NEXT_PUBLIC_LIVEKIT_URL ||
      process.env.LIVEKIT_URL ||
      'wss://demo.livekit.cloud';

    // 1. Direct JWT generation if API key & secret are present
    if (apiKey && apiSecret) {
      const token = generateLiveKitJwt(
        apiKey,
        apiSecret,
        roomName,
        participantIdentity,
        participantName
      );

      return NextResponse.json(
        {
          token,
          livekitUrl,
          roomName,
          participantIdentity,
          expiresInSeconds: 14400,
          isMock: false,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    // 2. Proxy to Supabase Edge Function if live Supabase is configured
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (
      supabaseUrl &&
      supabaseAnonKey &&
      !supabaseUrl.includes('mock-messenger') &&
      !supabaseAnonKey.includes('mock-')
    ) {
      const incomingAuth = req.headers.get('authorization');
      try {
        const edgeRes = await fetch(`${supabaseUrl}/functions/v1/livekit-token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseAnonKey,
            Authorization: incomingAuth || `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            roomName,
            participantIdentity,
            participantName,
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          return NextResponse.json(
            { ...edgeData, isMock: false },
            { headers: NO_STORE_HEADERS }
          );
        }
      } catch (proxyError) {
        console.warn('Proxy to Supabase Edge Function failed, falling back to mock token:', proxyError);
      }
    }

    // 3. Safe fallback mock token for development and unset credentials
    const mockPayload = {
      room: roomName,
      identity: participantIdentity,
      name: participantName || participantIdentity,
      exp: Math.floor(Date.now() / 1000) + 14400,
    };
    const mockToken = `mock-livekit-jwt-${Buffer.from(JSON.stringify(mockPayload)).toString('base64url')}`;

    return NextResponse.json(
      {
        token: mockToken,
        livekitUrl,
        roomName,
        participantIdentity,
        expiresInSeconds: 14400,
        isMock: true,
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to generate token';
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse('ok', {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
