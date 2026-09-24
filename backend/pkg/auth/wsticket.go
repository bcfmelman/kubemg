package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"
)

// wsTicketTTL is how long a minted ticket may be redeemed. A ticket only has
// to survive the moment between "the console asks for one" and "the browser's
// WebSocket constructor opens the handshake" — normally milliseconds. Seconds
// leaves headroom for a slow network without leaving a window worth replaying
// a leaked query string for.
const wsTicketTTL = 20 * time.Second

// wsTicketBytes is the entropy behind a ticket. It is opaque and single-use,
// so — unlike the JWT it stands in for — there is nothing in it to verify
// offline; its only job is to be unguessable and to be looked up once.
const wsTicketBytes = 32

// IssueWSTicket mints a short-lived, single-use ticket bound to claims already
// verified by RequireAuth's header path, so it can carry no more privilege
// than the request that asked for it.
//
// This exists because a browser cannot set a header when it opens a
// WebSocket, so the interactive terminal and the browser shell put a
// credential on the query string instead — see QueryTokenParam. Putting the
// session JWT itself there means every proxy, load balancer and access log in
// front of the backend gets a copy of a credential good for the rest of the
// session. A ticket is worthless the moment it is used, or twenty seconds
// after it is minted, whichever comes first, so a copy sitting in a log line
// is not a session left to replay.
func (m *Manager) IssueWSTicket(claims *Claims) (string, error) {
	buf := make([]byte, wsTicketBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate websocket ticket: %w", err)
	}
	ticket := base64.RawURLEncoding.EncodeToString(buf)

	issued := *claims
	m.wsTickets.Put("", ticket, &issued)
	return ticket, nil
}

// redeemWSTicket consumes a ticket, returning the claims it was minted for. A
// ticket answers at most once: whether this is its legitimate holder's only
// use or an attacker's replay of a leaked query string, the second
// presentation fails the same way the first success did not.
func (m *Manager) redeemWSTicket(ticket string) (*Claims, bool) {
	return m.wsTickets.Take(ticket)
}
