import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { MessageCircle, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { connectSocket } from '../lib/socket';
import type { Booking, Service, Slot } from '../lib/types';
import type { Socket } from 'socket.io-client';

function localTime(utc: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(utc),
  );
}

export function BookingPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState('');
  const [booking, setBooking] = useState<Booking | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [activeChat, setActiveChat] = useState<Booking | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: string; senderId: string; body: string; createdAt: string }>
  >([]);
  const [messageDraft, setMessageDraft] = useState('');
  const chatSocket = useRef<Socket | null>(null);
  const service = services.find((item) => item._id === serviceId);
  const dateLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${date}T12:00:00Z`)),
    [date],
  );

  async function loadServices() {
    const response = await api.get<{ services: Service[] }>('/services');
    setServices(response.data.services);
    setServiceId((current) => current || response.data.services[0]?._id || '');
  }

  const loadSlots = useCallback(async () => {
    if (!serviceId) return;
    const response = await api.get<{ slots: Slot[] }>('/slots', { params: { serviceId, date } });
    setSlots(response.data.slots);
  }, [serviceId, date]);

  async function loadBookings() {
    const response = await api.get<{ bookings: Booking[] }>('/bookings/me');
    setMyBookings(response.data.bookings);
  }

  useEffect(() => {
    void loadServices().catch(() => toast.error('Could not load services'));
  }, []);
  useEffect(() => {
    void loadBookings().catch(() => toast.error('Could not load your bookings'));
  }, []);
  useEffect(() => {
    setSelected('');
    void loadSlots().catch(() => toast.error('Could not load availability'));
  }, [loadSlots]);
  useEffect(() => {
    if (!user) return;
    const socket = connectSocket(sessionStorage.getItem('consultbook-access-token') ?? '');
    socket.on('connect', () => socket.emit('room:join', { kind: 'slots', serviceId, date }));
    const refresh = () => {
      void loadSlots();
    };
    socket.on('slot:held', refresh);
    socket.on('slot:released', refresh);
    socket.on('slot:booked', refresh);
    socket.on(
      'chat:message',
      (message: { id: string; senderId: string; body: string; createdAt: string }) => {
        setMessages((current) =>
          current.some((item) => item.id === message.id) ? current : [...current, message],
        );
      },
    );
    socket.on('booking:confirmed', (event: { bookingId: string }) => {
      setBooking((current) =>
        current?._id === event.bookingId ? { ...current, status: 'CONFIRMED' } : current,
      );
      void loadBookings();
    });
    chatSocket.current = socket;
    return () => {
      chatSocket.current = null;
      socket.disconnect();
    };
  }, [user, serviceId, date, loadSlots]);
  useEffect(() => {
    if (!booking || booking.status !== 'PENDING') return;
    const update = () =>
      setRemaining(
        Math.max(0, Math.ceil((new Date(booking.expiresAt).getTime() - Date.now()) / 1000)),
      );
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [booking]);

  useEffect(() => {
    const returnedBookingId = searchParams.get('booking_id');
    const checkoutResult = searchParams.get('checkout');
    if (!returnedBookingId || !checkoutResult) return;
    setSearchParams({}, { replace: true });
    let attempts = 0;
    const checkStatus = async () => {
      try {
        const { data } = await api.get<{ booking: Booking }>(`/bookings/${returnedBookingId}`);
        setBooking(data.booking);
        if (data.booking.status === 'CONFIRMED') {
          toast.success('Your booking is confirmed');
          return;
        }
        if (checkoutResult === 'cancel') {
          toast('Checkout was cancelled. Your 10-minute hold is still active.');
          return;
        }
        if (attempts < 5 && data.booking.status === 'PENDING') {
          attempts += 1;
          window.setTimeout(() => void checkStatus(), 3000);
        } else {
          toast('Waiting for Stripe payment confirmation');
        }
      } catch {
        toast.error('Could not retrieve your booking');
      }
    };
    void checkStatus();
  }, [searchParams, setSearchParams]);

  async function refreshBookingStatus(bookingId: string) {
    try {
      const response = await api.get<{ booking: Booking }>(`/bookings/${bookingId}`);
      setBooking(response.data.booking);
      if (response.data.booking.status === 'CONFIRMED') toast.success('Your booking is confirmed');
    } catch {
      toast.error('Could not refresh booking status');
    }
  }

  async function reserve() {
    if (!service || !selected) return;
    setLoading(true);
    try {
      const response = await api.post<{
        booking: {
          bookingId: string;
          orderId: string;
          checkoutUrl: string | null;
          amount: number;
          expiresAt: string;
        };
      }>('/bookings', { serviceId, startTime: selected });
      const hold = response.data.booking;
      const bookingState = {
        _id: hold.bookingId,
        serviceName: service.name,
        amount: hold.amount,
        startTime: selected,
        endTime: new Date(
          new Date(selected).getTime() + service.durationMinutes * 60_000,
        ).toISOString(),
        status: 'PENDING' as const,
        expiresAt: hold.expiresAt,
      };
      setBooking(bookingState);
      void loadBookings();
      if (hold.orderId.startsWith('local_')) {
        toast('Local payment order created. Add Stripe test keys to open Checkout.', {
          icon: 'i',
        });
        return;
      }
      if (!hold.checkoutUrl) throw new Error('Stripe Checkout URL was not returned');
      window.location.assign(hold.checkoutUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That time is no longer available');
      await loadSlots();
    } finally {
      setLoading(false);
    }
  }

  async function openChat(item: Booking) {
    setActiveChat(item);
    try {
      const response = await api.get<{
        messages: Array<{ _id: string; senderId: string; body: string; createdAt: string }>;
      }>(`/bookings/${item._id}/messages`);
      setMessages(
        response.data.messages.reverse().map((message) => ({
          id: message._id,
          senderId: message.senderId,
          body: message.body,
          createdAt: message.createdAt,
        })),
      );
      chatSocket.current?.emit(
        'room:join',
        { kind: 'booking', bookingId: item._id },
        (result: { ok: boolean }) => {
          if (!result.ok) toast.error('Could not open this conversation');
        },
      );
    } catch {
      toast.error('Chat is available for confirmed bookings');
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = messageDraft.trim();
    if (!body || !activeChat) return;
    chatSocket.current?.emit(
      'chat:message',
      { bookingId: activeChat._id, body },
      (result: { ok: boolean }) => {
        if (!result.ok) toast.error('Message could not be sent');
        else setMessageDraft('');
      },
    );
  }

  return (
    <div className="booking-page page-enter">
      <section className="booking-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> YOUR NEXT CONVERSATION
          </div>
          <h1>
            Make room
            <br />
            <em>for a good idea.</em>
          </h1>
          <p>Choose a session, find a time, and we’ll take it from there.</p>
        </div>
        <div className="heading-stamp">
          <span>01</span>
          <div>
            BOOKING
            <br />
            WINDOW
          </div>
          <CalendarDays size={19} />
        </div>
      </section>
      <div className="booking-layout">
        <section className="booking-main">
          <div className="section-head">
            <div className="step-index">01</div>
            <div>
              <h2>Choose your session</h2>
              <p>Each conversation is shaped around you.</p>
            </div>
          </div>
          <div className="service-list">
            {services.map((item, index) => (
              <button
                key={item._id}
                className={`service-row ${serviceId === item._id ? 'selected' : ''}`}
                onClick={() => setServiceId(item._id)}
              >
                <span className={`service-number service-number-${index}`}>0{index + 1}</span>
                <span className="service-info">
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="service-meta">
                  <span>{item.durationMinutes} min</span>
                  <strong>₹{(item.price / 100).toLocaleString('en-IN')}</strong>
                </span>
                <span className="selection-check">
                  {serviceId === item._id && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
          <div className="section-head date-head">
            <div className="step-index">02</div>
            <div>
              <h2>Find a time</h2>
              <p>Times are shown in your local timezone.</p>
            </div>
          </div>
          <div className="date-control">
            <label htmlFor="booking-date">DATE</label>
            <input
              id="booking-date"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <span>{dateLabel}</span>
          </div>
          <div className="slots-topline">
            <span>AVAILABLE START TIMES</span>
            <button
              className="icon-button refresh-button"
              title="Refresh availability"
              onClick={() => void loadSlots()}
            >
              <RefreshCw size={15} />
            </button>
          </div>
          <div className="slot-grid">
            {slots.length === 0 ? (
              <div className="empty-slots">No open times on this date. Try another day.</div>
            ) : (
              slots.map((slot) => (
                <button
                  key={slot.startTime}
                  className={`slot-button ${selected === slot.startTime ? 'active' : ''} ${slot.status !== 'AVAILABLE' ? 'disabled' : ''}`}
                  disabled={slot.status !== 'AVAILABLE'}
                  onClick={() => setSelected(slot.startTime)}
                >
                  <Clock3 size={14} />
                  {localTime(slot.startTime)}
                  {slot.status === 'PENDING' ? <span className="slot-state">HELD</span> : null}
                  {slot.status === 'CONFIRMED' ? <span className="slot-state">TAKEN</span> : null}
                </button>
              ))
            )}
          </div>
        </section>
        <aside className="booking-summary">
          <div className="summary-top">
            <span className="eyebrow light">
              <span className="eyebrow-line" /> RESERVATION
            </span>
            <Sparkles size={18} />
          </div>
          <h3>
            Your session,
            <br />
            <em>at a glance.</em>
          </h3>
          <div className="summary-rule" />
          <div className="summary-line">
            <span>SESSION</span>
            <strong>{service?.name ?? 'Select a session'}</strong>
          </div>
          <div className="summary-line">
            <span>WHEN</span>
            <strong>{selected ? `${dateLabel} · ${localTime(selected)}` : 'Choose a time'}</strong>
          </div>
          <div className="summary-line">
            <span>DURATION</span>
            <strong>{service ? `${service.durationMinutes} minutes` : '—'}</strong>
          </div>
          <div className="summary-price">
            <span>TOTAL · INR</span>
            <strong>{service ? `₹${(service.price / 100).toLocaleString('en-IN')}` : '—'}</strong>
          </div>
          <button
            className="button button-coral button-full"
            disabled={!selected || loading}
            onClick={() => void reserve()}
          >
            {loading ? 'Reserving…' : 'Continue to payment'} <ArrowRight size={16} />
          </button>
          <div className="secure-note">
            <ShieldCheck size={15} /> Secure checkout via Razorpay
          </div>
          <div className="payment-note">
            <CreditCard size={14} /> Your slot is held for 10 minutes after reservation.
          </div>
        </aside>
      </div>
      {booking && (
        <section className={`payment-status ${booking.status === 'CONFIRMED' ? 'confirmed' : ''}`}>
          <div className="status-icon">
            {booking.status === 'CONFIRMED' ? <Check size={18} /> : <Clock3 size={18} />}
          </div>
          <div className="status-copy">
            <strong>
              {booking.status === 'CONFIRMED'
                ? 'Booking confirmed'
                : 'Waiting for payment confirmation'}
            </strong>
            <span>
              {booking.status === 'CONFIRMED'
                ? `${booking.serviceName} · ${new Date(booking.startTime).toLocaleString()}`
                : `Complete checkout before this hold expires · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
            </span>
          </div>
          {booking.status !== 'CONFIRMED' && (
            <button className="text-button" onClick={() => void refreshBookingStatus(booking._id)}>
              Check status
            </button>
          )}
        </section>
      )}
      <section className="my-bookings">
        <div className="section-title-row">
          <div>
            <div className="eyebrow">
              <span className="eyebrow-line" /> YOUR SCHEDULE
            </div>
            <h2>My bookings</h2>
          </div>
          <button
            className="icon-button"
            title="Refresh bookings"
            onClick={() => void loadBookings()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
        {myBookings.length === 0 ? (
          <p className="muted">Your bookings will appear here after you reserve a time.</p>
        ) : (
          myBookings.map((item) => (
            <article className="my-booking-row" key={item._id}>
              <span className={`status-dot status-dot-${item.status.toLowerCase()}`} />
              <div className="my-booking-copy">
                <strong>{item.serviceName}</strong>
                <span>
                  {new Date(item.startTime).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
              </div>
              <span className={`status-tag status-${item.status.toLowerCase()}`}>
                {item.status}
              </span>
              {item.status === 'CONFIRMED' && (
                <button
                  className="icon-button chat-open"
                  title="Open booking chat"
                  onClick={() => void openChat(item)}
                >
                  <MessageCircle size={16} />
                </button>
              )}
            </article>
          ))
        )}
      </section>
      {activeChat && (
        <section className="chat-panel">
          <div className="chat-heading">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> CONFIRMED SESSION
              </div>
              <h2>{activeChat.serviceName} · Chat</h2>
            </div>
            <button className="icon-button" title="Close chat" onClick={() => setActiveChat(null)}>
              ×
            </button>
          </div>
          <div className="chat-messages">
            {messages.length === 0 ? (
              <span className="muted">Start the conversation about your session.</span>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`chat-message ${message.senderId === user?.id ? 'own-message' : ''}`}
                >
                  <p>{message.body}</p>
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              ))
            )}
          </div>
          <form className="chat-compose" onSubmit={sendMessage}>
            <input
              maxLength={1000}
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              placeholder="Write a message"
            />
            <button className="icon-button" title="Send message" disabled={!messageDraft.trim()}>
              <Send size={16} />
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
