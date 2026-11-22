from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.core.realtime import TICKET_TTL_SECONDS, issue_ticket

router = APIRouter(prefix="/realtime", tags=["realtime"])


class SocketTicket(BaseModel):
    ticket: str
    expires_in: int


@router.post("/ticket", response_model=SocketTicket, summary="One-time pass for opening a Socket.IO connection")
async def socket_ticket(request: Request, user: CurrentUser) -> SocketTicket:
    session_id = str(request.state.session_id)
    return SocketTicket(ticket=await issue_ticket(user.id, user.role.value, session_id), expires_in=TICKET_TTL_SECONDS)
