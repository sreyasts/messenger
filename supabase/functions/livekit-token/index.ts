// Supabase Edge Function: livekit-token
// Generates LiveKit Cloud WebRTC AccessTokens for Voice and Video Calls

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { AccessToken } from "npm:livekit-server-sdk@^2.6.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface TokenRequestBody {
  roomName: string;
  participantIdentity: string;
  participantName?: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("LIVEKIT_API_KEY");
    const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    const livekitUrl = Deno.env.get("LIVEKIT_URL") || "wss://your-project.livekit.cloud";

    if (!apiKey || !apiSecret) {
      return new Response(
        JSON.stringify({
          error: "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured in environment variables.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let body: TokenRequestBody;
    try {
      body = await req.json();
      if (!body || typeof body !== "object") {
        throw new Error("Missing or invalid JSON body");
      }
    } catch {
      return new Response(
        JSON.stringify({
          error: "Invalid JSON or missing request body.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const roomName = body.roomName?.trim();
    const participantIdentity = body.participantIdentity?.trim();
    const participantName = body.participantName?.trim();

    if (!roomName || !participantIdentity) {
      return new Response(
        JSON.stringify({
          error: "Missing required parameters: 'roomName' and 'participantIdentity' are required.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create LiveKit AccessToken with 4 hour TTL
    const at = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      name: participantName || participantIdentity,
      ttl: 4 * 60 * 60, // 4 hours in seconds
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return new Response(
      JSON.stringify({
        token,
        livekitUrl,
        roomName,
        participantIdentity,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message || "Failed to generate token" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
