/**
 * College API Client for Knotopian Institute of Technology (KIT)
 * Bound to the official KIT OpenAPI contract at https://ht.knowvally.com/v1/
 */

export class CollegeAPIError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'CollegeAPIError';
    this.statusCode = statusCode;
  }
}

export class CollegeAPIAuthError extends CollegeAPIError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'CollegeAPIAuthError';
  }
}

export class CollegeAPIUnavailableError extends CollegeAPIError {
  constructor(message: string, statusCode?: number) {
    super(message, statusCode);
    this.name = 'CollegeAPIUnavailableError';
  }
}

export interface CollegeUser {
  id: number;
  login_id: string;
  full_name: string;
  role: 'student' | 'teacher' | 'public';
  department: string;
  class_id?: number | null;
  class_code?: string | null;
  programme?: string | null;
  year_of_study?: number | null;
  notes?: string | null;
}

export interface CollegeLoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: CollegeUser;
}

export interface TodayInfo {
  date: string;
  weekday: number;
  weekday_name: string;
  timezone: string;
}

export interface CollegeInfo {
  name: string;
  code: string;
  tagline: string;
  description: string;
  contact: {
    phone: string;
    email: string;
    website: string;
    address: string;
  };
}

export interface CourseItem {
  id: number;
  code: string;
  name: string;
  department: string;
  min_12th_percent: number;
  annual_fee: number;
  hostel_fee: number;
  seats: number;
}

export interface AttendanceSummary {
  as_of_date: string;
  overall_percentage: number;
  total_classes_held: number;
  total_classes_attended: number;
  subjects: Array<{
    subject_id: number;
    subject_code: string;
    subject_name: string;
    classes_held: number;
    classes_attended: number;
    classes_od: number;
    classes_absent: number;
    percentage: number;
  }>;
}

export interface TimetableSlot {
  id: number;
  weekday: number; // 1=Mon ... 6=Sat
  period: number;
  start_time: string;
  end_time: string;
  subject_code: string;
  subject_name: string;
}

export interface CalendarEntry {
  id: number;
  date: string;
  type: 'holiday' | 'internal_exam' | 'exam' | 'event' | string;
  title: string;
  subject_code?: string | null;
  follows_weekday?: number | null;
  status: string;
}

export interface StudentRequest {
  id: number;
  student_id: number;
  student_name: string;
  class_code: string;
  type: string;
  from_date: string;
  to_date: string;
  half_day: boolean;
  reason: string;
  event_name?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  teacher_comment?: string | null;
  rejection_reason?: string | null;
  created_at?: string;
}

export class CollegeAPIClient {
  private baseUrl: string;
  private participantKey: string;
  private timeoutMs: number;

  constructor() {
    this.baseUrl = (process.env.COLLEGE_API_BASE_URL || 'https://ht.knowvally.com').replace(/\/+$/, '');
    this.participantKey = process.env.COLLEGE_PARTICIPANT_KEY || 'kit_live_521a568a005f9b3eefea91b7b5ad539f6d76e770';
    this.timeoutMs = parseInt(process.env.COLLEGE_API_TIMEOUT_SECONDS || '10', 10) * 1000;
  }

  private async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: any;
      token?: string;
      idempotencyKey?: string;
      params?: Record<string, string | number | boolean | undefined>;
    } = {}
  ): Promise<T> {
    const { method = 'GET', body, token, idempotencyKey, params } = options;

    let urlStr = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) {
        urlStr += (urlStr.includes('?') ? '&' : '?') + qs;
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Participant-Key': this.participantKey,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const resp = await fetch(urlStr, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (resp.status === 401 || resp.status === 403) {
        const errorText = await resp.text().catch(() => '');
        throw new CollegeAPIAuthError(
          `College API authorization failed (${resp.status}): ${errorText}`,
          resp.status
        );
      }

      if (resp.status === 404) {
        throw new CollegeAPIError(`College API resource not found at ${path}`, 404);
      }

      if (resp.status >= 500) {
        throw new CollegeAPIUnavailableError(`College API server error (${resp.status})`, resp.status);
      }

      if (!resp.ok) {
        const err = await resp.text().catch(() => 'Unknown error');
        throw new CollegeAPIError(`College API error (${resp.status}): ${err}`, resp.status);
      }

      if (resp.status === 204) {
        return { success: true } as any;
      }

      const data = await resp.json();
      return data as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new CollegeAPIUnavailableError(`College API request timed out after ${this.timeoutMs}ms`, 504);
      }
      if (err instanceof CollegeAPIError) {
        throw err;
      }
      throw new CollegeAPIUnavailableError(`College API network error: ${err.message}`, 503);
    }
  }

  // === Health & Public ===

  async checkHealth(): Promise<{ status: string; app: string; version: string }> {
    return this.request('/v1/health');
  }

  async getToday(): Promise<TodayInfo> {
    return this.request<TodayInfo>('/v1/today');
  }

  async getCollegeInfo(): Promise<CollegeInfo> {
    return this.request<CollegeInfo>('/v1/college');
  }

  async listCourses(): Promise<CourseItem[]> {
    const res = await this.request('/v1/courses');
    return Array.isArray(res) ? res : (res?.value || []);
  }

  async submitAdmissionApplication(data: {
    full_name: string;
    phone: string;
    email: string;
    course_code: string;
    twelfth_percent: number;
    idempotencyKey?: string;
  }): Promise<{ id: number; application_number: string; message: string }> {
    return this.request('/v1/admissions/applications', {
      method: 'POST',
      body: {
        full_name: data.full_name,
        phone: data.phone,
        email: data.email,
        course_code: data.course_code,
        twelfth_percent: data.twelfth_percent,
      },
      idempotencyKey: data.idempotencyKey,
    });
  }

  async listDocuments(): Promise<any[]> {
    return this.request('/v1/documents');
  }

  // === Authentication ===

  async login(login_id: string, password: string): Promise<CollegeLoginResponse> {
    return this.request<CollegeLoginResponse>('/v1/auth/login', {
      method: 'POST',
      body: { login_id, password },
    });
  }

  // === Student Endpoints ===

  async getMe(token: string): Promise<CollegeUser> {
    return this.request<CollegeUser>('/v1/me', { token });
  }

  async getMyAcademics(token: string): Promise<any> {
    return this.request('/v1/me/academics', { token });
  }

  async getMySubjects(token: string): Promise<any[]> {
    return this.request('/v1/me/subjects', { token });
  }

  async getMyAttendance(token: string): Promise<AttendanceSummary> {
    return this.request<AttendanceSummary>('/v1/me/attendance', { token });
  }

  async getMyTimetable(token: string): Promise<TimetableSlot[]> {
    return this.request<TimetableSlot[]>('/v1/me/timetable', { token });
  }

  async getCalendar(
    token?: string,
    params?: { from?: string; to?: string }
  ): Promise<CalendarEntry[]> {
    return this.request<CalendarEntry[]>('/v1/calendar', { token, params });
  }

  async getMyRequests(token: string): Promise<StudentRequest[]> {
    return this.request<StudentRequest[]>('/v1/me/requests', { token });
  }

  async getRequestDetails(token: string, requestId: number): Promise<StudentRequest> {
    return this.request<StudentRequest>(`/v1/me/requests/${requestId}`, { token });
  }

  async createLeaveOrODRequest(
    token: string,
    data: {
      type: 'personal_leave' | 'medical_leave' | 'on_duty';
      from_date: string;
      to_date: string;
      reason: string;
      half_day?: boolean;
      event_name?: string;
      idempotencyKey?: string;
    }
  ): Promise<StudentRequest> {
    return this.request<StudentRequest>('/v1/me/requests', {
      method: 'POST',
      token,
      body: {
        type: data.type,
        from_date: data.from_date,
        to_date: data.to_date,
        half_day: Boolean(data.half_day),
        reason: data.reason,
        event_name: data.event_name || undefined,
      },
      idempotencyKey: data.idempotencyKey,
    });
  }

  async cancelRequest(token: string, requestId: number): Promise<any> {
    return this.request(`/v1/me/requests/${requestId}/cancel`, {
      method: 'POST',
      token,
    });
  }

  async listPlacementDrives(): Promise<any[]> {
    return this.request('/v1/placements/drives');
  }

  async registerPlacementDrive(token: string, driveId: number): Promise<any> {
    return this.request(`/v1/placements/drives/${driveId}/register`, {
      method: 'POST',
      token,
    });
  }

  async getMyPlacements(token: string): Promise<any[]> {
    return this.request('/v1/me/placements', { token });
  }

  // === Teacher Endpoints ===

  async getTeacherClasses(token: string): Promise<any[]> {
    return this.request('/v1/teacher/classes', { token });
  }

  async getTeacherRequests(token: string, status?: string): Promise<StudentRequest[]> {
    return this.request<StudentRequest[]>('/v1/teacher/requests', {
      token,
      params: status ? { status } : undefined,
    });
  }

  async getClassAttendance(token: string, classId: number): Promise<any> {
    return this.request(`/v1/teacher/classes/${classId}/attendance`, { token });
  }

  async approveTeacherRequest(
    token: string,
    requestId: number,
    comment?: string
  ): Promise<StudentRequest> {
    return this.request<StudentRequest>(`/v1/teacher/requests/${requestId}/approve`, {
      method: 'POST',
      token,
      body: comment ? { comment } : undefined,
    });
  }

  async rejectTeacherRequest(
    token: string,
    requestId: number,
    reason: string
  ): Promise<StudentRequest> {
    return this.request<StudentRequest>(`/v1/teacher/requests/${requestId}/reject`, {
      method: 'POST',
      token,
      body: { reason },
    });
  }
}

// Singleton helper
let collegeClientInstance: CollegeAPIClient | null = null;
export function getCollegeAPIClient(): CollegeAPIClient {
  if (!collegeClientInstance) {
    collegeClientInstance = new CollegeAPIClient();
  }
  return collegeClientInstance;
}
