"""
WhatsApp Channel via Twilio.
Optional — only active if WHATSAPP_ENABLED=true in .env.

Setup:
  1. Create Twilio account → get SID + Auth Token
  2. Set up WhatsApp Sandbox or Business number
  3. Point Twilio webhook to: https://your-server/api/whatsapp/webhook
"""
from fastapi import APIRouter, Request, Response
from app.core.config import settings
from app.core.logging import logger

router = APIRouter()


def is_enabled() -> bool:
    return settings.whatsapp_enabled and bool(settings.twilio_account_sid)


async def send_message(to: str, body: str):
    """Send a WhatsApp message via Twilio."""
    if not is_enabled():
        logger.warning("WhatsApp not configured")
        return

    from twilio.rest import Client
    client = Client(settings.twilio_account_sid, settings.twilio_auth_token)

    message = client.messages.create(
        body=body[:4096],  # WhatsApp limit
        from_=settings.twilio_whatsapp_number,
        to=to,
    )
    logger.info(f"WhatsApp sent to {to}: {message.sid}")
    return message.sid


@router.post("/webhook")
async def whatsapp_webhook(request: Request):
    """
    Twilio calls this when a WhatsApp message arrives.
    Flow: receive → gateway.process() → reply via Twilio.
    """
    if not is_enabled():
        return Response(status_code=404)

    form = await request.form()
    body = form.get("Body", "")
    from_number = form.get("From", "")  # e.g., whatsapp:+1234567890
    
    if not body or not from_number:
        return Response(status_code=400)

    logger.info(f"WhatsApp from {from_number}: {body[:80]}")

    # Process through gateway
    from app.agent.gateway import get_gateway
    gateway = get_gateway()

    # Use phone number as client_id
    client_id = from_number.replace("whatsapp:", "wa_")
    response_text = await gateway.process(body, client_id=client_id, channel="whatsapp")

    # Send response back via Twilio
    await send_message(from_number, response_text)

    # Return TwiML empty response (we send manually)
    return Response(
        content='<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
        media_type="application/xml",
    )


@router.get("/webhook")
async def whatsapp_verify(request: Request):
    """Verification endpoint for Twilio webhook setup."""
    return Response(content="OK", status_code=200)
