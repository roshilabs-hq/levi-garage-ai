# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Car owners from the Krayot and Haifa bay area, mostly on a phone, arriving in one of three moments: "I need a garage" (a warning light, an upcoming annual test, a periodic service), "where is my car" (the car is already in the shop), or "is this place honest" (comparing garages after a bad experience elsewhere). Secondary: owners of small business fleets (3 to 25 vehicles). The audience is mixed Hebrew, Arabic and Russian speaking, with a meaningful share of older customers who still prefer to call.

## Product Purpose
The public face of "מוסך לוי ובניו". Its one job: let a customer book a car drop-off by themselves in under a minute, and trust the garage enough to do it. It replaces a 2016 Wix site the owner calls embarrassing. Success means fewer phone calls to the owner (the garage gets 60 to 80 calls a day, about 25 of them "when is my car ready"), more self-booked drop-offs, and a site the owner is proud to show a customer.

## Positioning
A family garage since 1998 (three generations: Shimon, Avi, Daniel) that makes three concrete promises answering its own Google complaints: no work without the customer's approval in WhatsApp, the price before the work, and a real "your car is ready" message instead of a guess. Multi-brand, independent, with a team that speaks Hebrew, Arabic and Russian.

## Operating Context
Industrial zone, Krayot (Haifa bay). Sunday to Thursday 07:00 to 17:00, Friday 07:00 to 12:00. Car drop-off window 07:00 to 09:00 by booking. 4 lifts and a diagnostics bay, about 15 cars a day. Visitors are on phones, often outdoors, sometimes next to a car with a warning light on.

## Capabilities and Constraints
- Rich single home page plus required pages: privacy policy, accessibility statement, terms.
- Primary action: booking through Cal.com (`https://cal.com/levi-garage/drop-off`), with fields prefilled from URL parameters (`plate`, `service`).
- Secondary: WhatsApp to the garage's assistant (answers 24/7, "when is my car ready" by plate). Tertiary: phone, visible, framed as "for towing and urgent cases".
- Plate lookup: the visitor types a license plate; the site queries the public Ministry of Transport vehicle registry (data.gov.il) and shows make, model, year and test expiry, with a prefilled booking link. The plate is not stored.
- On-site information assistant ("ask us"): answers only from the garage's closed knowledge base (hours, location, services, starting prices, FAQ, policies), never invents a price, never diagnoses, hands off to booking or WhatsApp. Same brain as the WhatsApp assistant. Rate limited, no personal data retained.
- Language switch: Hebrew (default, RTL), Arabic (RTL), Russian (LTR) for the main content.
- No link from the customer site to the staff area (changed 27.9). Staff enter at `/staff` directly; the two audiences are unrelated.
- Legal: Israeli Privacy Protection Law (including Amendment 13) and accessibility regulations (IS 5568, WCAG 2.0 AA).
- OPEN: the WhatsApp number shown is the owner's real Green API number (for a live demo). Before publishing it, the routing must send every sender except the owner to the garage bot, not to the owner's personal assistant.
- OPEN: the phone number shown on the site is fictional and marked as such.

## Brand Commitments
- Name: "מוסך לוי ובניו", subtitle "מכונאות, חשמל ומיזוג רכב". Since 1998.
- Voice: direct, warm, workshop-honest. Short sentences. Concrete promises, no marketing inflation. The words "AI" and "bot" do not appear in customer-facing copy.
- Site language: Hebrew RTL first, with Arabic and Russian.

## Evidence on Hand
- No real photographs exist (the business is fictional for a course project). Imagery is AI-generated (workshop, lifts, tools, working hands, and staff portraits) and must be disclosed as illustrative.
- No real customer testimonials. Do not invent reviews, quotes, ratings or customer counts.
- Real, citable facts: founding year 1998, three generations, 4 lifts, services list, opening hours, drop-off window, starting prices from the persona (small service 450 to 650 ₪, large service 1,200 to 2,500 ₪, repairs 300 to 8,000 ₪).

## Product Principles
1. Answer the reason for the call, instead of hiding the phone.
2. Every promise on the site is something the garage's systems actually do.
3. Booking is the one primary action; everything else supports it.
4. Nothing fabricated: no fake reviews, no fake urgency, no invented numbers.
5. Works for a 65-year-old on a small phone in the sun as well as for a 27-year-old.

## Accessibility & Inclusion
IS 5568 at WCAG 2.0 AA as a legal minimum; an accessibility statement page with a real contact for accessibility requests. Three languages including two RTL. Respect reduced motion. Large tap targets for use next to a car.
