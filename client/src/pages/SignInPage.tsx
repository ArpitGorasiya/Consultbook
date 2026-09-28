import { useState } from 'react';
import { ArrowRight, CalendarCheck2, KeyRound, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
type Credentials = z.infer<typeof schema>;

export function SignInPage() {
  const [registering, setRegistering] = useState(false);
  const { setSession } = useAuth();
  const navigate = useNavigate();
  const form = useForm<Credentials>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  async function submit(values: Credentials) {
    try {
      if (registering) {
        const name = values.email.split('@')[0] ?? 'Client';
        const response = await api.post('/auth/register', { ...values, name });
        setSession(response.data.user, response.data.accessToken);
      } else {
        const response = await api.post('/auth/login', values);
        setSession(response.data.user, response.data.accessToken);
      }
      navigate('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to sign in');
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-aside">
        <div className="auth-orbit orbit-one" />
        <div className="auth-orbit orbit-two" />
        <a className="brand brand-on-dark" href="/">
          <span className="brand-mark">
            <Sparkles size={17} />
          </span>
          <span>
            consultbook<span className="brand-live">live</span>
          </span>
        </a>
        <div className="auth-message">
          <div className="eyebrow light">
            <span className="eyebrow-line" /> SPACE FOR WHAT MATTERS
          </div>
          <h1>
            Good work
            <br />
            <em>starts here.</em>
          </h1>
          <p>A considered place to meet, think clearly, and move forward.</p>
          <div className="auth-proof">
            <CalendarCheck2 size={18} />
            <span>Appointments that fit your day</span>
          </div>
        </div>
        <div className="auth-coordinate">EST. 2026&nbsp; · &nbsp;PRIVATE CONSULTATIONS</div>
      </section>
      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={form.handleSubmit(submit)}>
          <div className="form-symbol">
            <KeyRound size={19} />
          </div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CLIENT PORTAL
          </div>
          <h2>{registering ? 'Create your account' : 'Welcome back'}</h2>
          <p className="muted">
            {registering
              ? 'Start planning your next conversation.'
              : 'Sign in to manage your consultations.'}
          </p>
          <label>
            Email address
            <input
              autoComplete="email"
              type="email"
              placeholder="you@example.com"
              {...form.register('email')}
            />
          </label>
          {form.formState.errors.email && (
            <span className="field-error">{form.formState.errors.email.message}</span>
          )}
          <label>
            Password
            <input
              autoComplete={registering ? 'new-password' : 'current-password'}
              type="password"
              placeholder="At least 8 characters"
              {...form.register('password')}
            />
          </label>
          {form.formState.errors.password && (
            <span className="field-error">{form.formState.errors.password.message}</span>
          )}
          <button className="button button-dark button-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting
              ? 'Please wait…'
              : registering
                ? 'Create account'
                : 'Sign in'}{' '}
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => setRegistering(!registering)}
          >
            {registering ? 'Already have an account? Sign in' : 'New here? Create a client account'}
          </button>
          <div className="form-footnote">
            Administrator access is provisioned through the seed script.
          </div>
        </form>
      </section>
    </main>
  );
}
