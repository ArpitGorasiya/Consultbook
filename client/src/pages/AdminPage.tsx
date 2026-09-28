import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  Plus,
  Search,
  UsersRound,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { connectSocket } from '../lib/socket';
import type { Booking, Service } from '../lib/types';

type AdminStats = { totalBookings: number; revenue: number; upcoming: number };
type TableBooking = Booking & { customerId?: { name: string; email: string } };

function money(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<AdminStats>({ totalBookings: 0, revenue: 0, upcoming: 0 });
  const [bookings, setBookings] = useState<TableBooking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [totalPages, setTotalPages] = useState(1);
  const [editing, setEditing] = useState<Service | null>(null);
  const [showServiceForm, setShowServiceForm] = useState(false);

  const refresh = useCallback(async () => {
    const params = { page, ...(status ? { status } : {}) };
    const [statsResponse, bookingsResponse, servicesResponse] = await Promise.all([
      api.get<{ stats: AdminStats }>('/admin/stats'),
      api.get<{ bookings: TableBooking[]; pages: number }>('/admin/bookings', { params }),
      api.get<{ services: Service[] }>('/admin/services'),
    ]);
    setStats(statsResponse.data.stats);
    setBookings(bookingsResponse.data.bookings);
    setTotalPages(Math.max(1, bookingsResponse.data.pages));
    setServices(servicesResponse.data.services);
  }, [page, status]);
  useEffect(() => {
    void refresh().catch(() => toast.error('Could not load the admin workspace'));
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const token = sessionStorage.getItem('consultbook-access-token') ?? '';
    const socket = connectSocket(token);
    socket.on('admin:new-booking', (event: { serviceName: string; startTime: string }) => {
      toast(`New booking · ${event.serviceName}`, { icon: '◉' });
      void refresh();
    });
    return () => {
      socket.disconnect();
    };
  }, [user, refresh]);

  const filtered = bookings.filter((booking) =>
    `${booking.serviceName} ${booking.customerId?.name ?? ''} ${booking.customerId?.email ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function toggleService(service: Service) {
    try {
      await api.put(`/services/${service._id}`, { ...service, isActive: !service.isActive });
      toast.success(service.isActive ? 'Service paused' : 'Service activated');
      await refresh();
    } catch {
      toast.error('Service update failed');
    }
  }

  async function saveService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      durationMinutes: Number(form.get('durationMinutes')),
      price: Math.round(Number(form.get('price')) * 100),
      isActive: form.get('isActive') === 'on',
    };
    try {
      if (editing) await api.put(`/services/${editing._id}`, input);
      else await api.post('/services', input);
      toast.success(editing ? 'Service updated' : 'Service added');
      setEditing(null);
      setShowServiceForm(false);
      await refresh();
    } catch {
      toast.error('Service could not be saved');
    }
  }

  return (
    <div className="admin-page page-enter">
      <div className="admin-heading">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CONTROL ROOM · MONITORING LIVE
          </div>
          <h1>
            Good morning,
            <br />
            <em>{user?.name.split(' ')[0]}.</em>
          </h1>
        </div>
        <span className="live-pill">
          <span className="live-dot" /> LIVE FEED
        </span>
      </div>
      <section className="stats-grid">
        <article className="stat-panel stat-dark">
          <span>
            TOTAL BOOKINGS <CalendarDays size={16} />
          </span>
          <strong>{stats.totalBookings.toLocaleString()}</strong>
          <small>All-time appointments</small>
          <i>01</i>
        </article>
        <article className="stat-panel stat-moss">
          <span>
            PAID REVENUE <CircleDollarSign size={16} />
          </span>
          <strong>{money(stats.revenue)}</strong>
          <small>Captured payments</small>
          <i>02</i>
        </article>
        <article className="stat-panel stat-light">
          <span>
            UPCOMING <UsersRound size={16} />
          </span>
          <strong>{stats.upcoming.toLocaleString()}</strong>
          <small>Confirmed sessions</small>
          <i>03</i>
        </article>
      </section>
      <div className="admin-columns">
        <section className="admin-section">
          <div className="section-title-row">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> SCHEDULE
              </div>
              <h2>Booking activity</h2>
            </div>
            <div className="filter-control">
              <select
                value={status}
                onChange={(event) => {
                  setPage(1);
                  setStatus(event.target.value);
                }}
              >
                <option value="">All statuses</option>
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="EXPIRED">Expired</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
          </div>
          <label className="search-field">
            <Search size={15} />
            <input
              placeholder="Search client or session"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>CLIENT</th>
                  <th>SESSION</th>
                  <th>DATE & TIME</th>
                  <th>STATUS</th>
                  <th>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((booking) => (
                  <tr key={booking._id}>
                    <td>
                      <strong>{booking.customerId?.name ?? 'Client'}</strong>
                      <small>{booking.customerId?.email ?? '—'}</small>
                    </td>
                    <td>{booking.serviceName}</td>
                    <td>
                      {new Date(booking.startTime).toLocaleString(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      <span className={`status-tag status-${booking.status.toLowerCase()}`}>
                        {booking.status}
                      </span>
                    </td>
                    <td>{money(booking.amount)}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty-row">
                      No bookings match this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              PAGE {page} OF {totalPages}
            </span>
            <div>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                Next <ArrowUpRight size={13} />
              </button>
            </div>
          </div>
        </section>
        <aside className="admin-rail">
          <div className="rail-title">
            <Activity size={16} />
            <span>LIVE OPERATIONS</span>
            <span className="live-dot" />
          </div>
          <div className="activity-item">
            <span className="activity-line" />
            <strong>Socket channel active</strong>
            <small>Admin room is receiving booking activity</small>
            <time>NOW</time>
          </div>
          <div className="activity-item">
            <span className="activity-line muted-line" />
            <strong>Payment watcher ready</strong>
            <small>Confirmation webhooks are processed server-side</small>
            <time>READY</time>
          </div>
          <div className="services-head">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> CATALOG
              </div>
              <h3>Services</h3>
            </div>
            <button
              className="icon-button"
              title="Add a service"
              onClick={() => {
                setEditing(null);
                setShowServiceForm(true);
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          {services.map((service) => (
            <div className="admin-service" key={service._id}>
              <button
                className="service-edit"
                onClick={() => {
                  setEditing(service);
                  setShowServiceForm(true);
                }}
              >
                <strong>{service.name}</strong>
                <small>
                  {service.durationMinutes} min · {money(service.price)}
                </small>
              </button>
              <button
                className={`switch ${service.isActive ? 'on' : ''}`}
                aria-label={service.isActive ? 'Pause service' : 'Activate service'}
                onClick={() => void toggleService(service)}
              />
            </div>
          ))}
          {showServiceForm && (
            <form className="service-editor" onSubmit={(event) => void saveService(event)}>
              <strong>{editing ? 'Edit service' : 'New service'}</strong>
              <input
                name="name"
                required
                minLength={2}
                maxLength={100}
                placeholder="Session name"
                defaultValue={editing?.name ?? ''}
              />
              <textarea
                name="description"
                required
                minLength={4}
                maxLength={2000}
                placeholder="Description"
                defaultValue={editing?.description ?? ''}
              />
              <div className="editor-row">
                <input
                  name="durationMinutes"
                  required
                  type="number"
                  min="5"
                  max="480"
                  placeholder="Minutes"
                  defaultValue={editing?.durationMinutes ?? 30}
                />
                <input
                  name="price"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="INR"
                  defaultValue={editing ? editing.price / 100 : 0}
                />
              </div>
              <label>
                <input name="isActive" type="checkbox" defaultChecked={editing?.isActive ?? true} />{' '}
                Active in catalog
              </label>
              <div className="editor-actions">
                <button type="button" onClick={() => setShowServiceForm(false)}>
                  Dismiss
                </button>
                <button type="submit">Save service</button>
              </div>
            </form>
          )}
          <button
            className="manage-services"
            onClick={() => {
              setEditing(null);
              setShowServiceForm(true);
            }}
          >
            Add or manage catalog <ArrowUpRight size={14} />
          </button>
        </aside>
      </div>
    </div>
  );
}
