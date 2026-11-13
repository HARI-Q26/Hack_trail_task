import { z } from 'zod';
import { getCollegeAPIClient } from '@/lib/college-api';
import { UserSessionData } from '@/lib/auth';
import { searchKnowledge } from '@/lib/knowledge';
import { resolveCollegeDate, validateLeaveDate } from '@/lib/policy-rules';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  actionRequired?: 'confirmation' | 'input';
  summary: string;
}

// === Tool Definitions for Groq ===

export const ALL_TOOLS: Record<string, { definition: ToolDefinition; allowedRoles: ('public' | 'student' | 'teacher')[] }> = {
  // --- Public & Admission Tools ---
  get_admission_information: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_admission_information',
        description: 'Get comprehensive official admission information, eligibility criteria, procedures, and dates for Knotopian Institute of Technology (KIT).',
        parameters: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              description: 'Specific topic like fees, eligibility, dates, quota, documents required, hostel',
            },
          },
        },
      },
    },
  },

  get_course_details: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_course_details',
        description: 'Retrieve real live degree courses, branch codes, fees, seats, and 12th minimum percentage requirements from the official College API.',
        parameters: {
          type: 'object',
          properties: {
            course_code: {
              type: 'string',
              description: 'Optional specific course code like BTECH-CSE, BTECH-ECE, BTECH-MECH. If requesting all courses, omit this parameter.',
            },
          },
        },
      },
    },
  },

  get_eligibility: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_eligibility',
        description: 'Check eligibility criteria for programmes offered at Knotopian Institute of Technology.',
        parameters: {
          type: 'object',
          properties: {
            programme: {
              type: 'string',
              description: 'Programme name or course, e.g. B.Tech Computer Science, B.Tech ECE, M.Tech',
            },
            percentage: {
              type: 'number',
              description: 'Candidate 12th board aggregate percentage',
            },
          },
        },
      },
    },
  },

  submit_admission_application: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'submit_admission_application',
        description: 'Submit an official prospective student admission application to Knotopian Institute of Technology via the College API.',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: 'Full name of the applicant' },
            phone: { type: 'string', description: 'Contact phone number' },
            email: { type: 'string', description: 'Contact email address' },
            course_code: { type: 'string', description: 'Degree course code (e.g. BTECH-CSE, BTECH-ECE, BTECH-MECH)' },
            twelfth_percent: { type: 'number', description: '12th standard aggregate percentage' },
            confirmed: { type: 'boolean', description: 'Set to true ONLY if applicant has explicitly reviewed and confirmed submission.' },
          },
          required: ['full_name', 'phone', 'email', 'course_code', 'twelfth_percent'],
        },
      },
    },
  },

  get_college_rules: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_college_rules',
        description: 'Retrieve official Knotopian Institute of Technology regulations, attendance policies, leave rules, and conduct code from the Student Handbook.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Rule or policy topic (e.g. attendance percentage, medical certificate, condonation, on-duty proof submission, dress code)',
            },
          },
          required: ['query'],
        },
      },
    },
  },

  get_holidays: {
    allowedRoles: ['public', 'student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_holidays',
        description: 'Retrieve official college holidays and calendar events from the live College API.',
        parameters: {
          type: 'object',
          properties: {
            from_date: { type: 'string', description: 'Optional start date YYYY-MM-DD' },
            to_date: { type: 'string', description: 'Optional end date YYYY-MM-DD' },
          },
        },
      },
    },
  },

  // --- Student Specific Tools ---
  get_student_profile: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'get_student_profile',
        description: 'Get the authenticated student profile, class code, department, and academic status from the College API.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  get_attendance: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'get_attendance',
        description: 'Retrieve the authenticated student real-time attendance percentage, classes held, attended, and subject-wise breakdown from the College API.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  get_timetable: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'get_timetable',
        description: 'Retrieve the authenticated student weekly timetable and class schedule from the College API.',
        parameters: {
          type: 'object',
          properties: {
            weekday: {
              type: 'integer',
              description: 'Day of week (1=Monday ... 6=Saturday). If omitted, returns entire week timetable.',
            },
          },
        },
      },
    },
  },

  get_exam_dates: {
    allowedRoles: ['student', 'teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_exam_dates',
        description: 'Retrieve scheduled internal assessments and end-semester examination dates from the College calendar API.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  get_my_requests: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'get_my_requests',
        description: 'Retrieve past leave and on-duty requests submitted by the authenticated student along with approval status.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  create_leave_request: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'create_leave_request',
        description: 'Submit an official student leave request (personal or medical) to the College API. Requires date and reason. Must be confirmed by student.',
        parameters: {
          type: 'object',
          properties: {
            date_or_keyword: {
              type: 'string',
              description: 'Leave date string (YYYY-MM-DD) or relative keyword (e.g. "tomorrow", "2026-11-25")',
            },
            to_date: {
              type: 'string',
              description: 'Optional end date for multi-day leave (YYYY-MM-DD). If omitted, single day leave is assumed.',
            },
            reason: {
              type: 'string',
              description: 'Clear statement of the reason for leave (e.g. "Personal work", "Family function", "Illness")',
            },
            leave_type: {
              type: 'string',
              enum: ['personal_leave', 'medical_leave'],
              description: 'Type of leave (defaults to personal_leave)',
            },
            half_day: {
              type: 'boolean',
              description: 'Whether leave is half day (morning/afternoon)',
            },
            confirmed: {
              type: 'boolean',
              description: 'Set to true ONLY when the student has explicitly confirmed submission after reviewing conflicts and details.',
            },
          },
          required: ['date_or_keyword', 'reason'],
        },
      },
    },
  },

  create_on_duty_request: {
    allowedRoles: ['student'],
    definition: {
      type: 'function',
      function: {
        name: 'create_on_duty_request',
        description: 'Submit an on-duty (OD) request for technical symposium, competition, sports, or academic conference. Requires date, event name, and reason.',
        parameters: {
          type: 'object',
          properties: {
            date_or_keyword: {
              type: 'string',
              description: 'OD date (YYYY-MM-DD) or relative keyword (e.g. "tomorrow", "2026-11-28")',
            },
            event_name: {
              type: 'string',
              description: 'Name of the symposium, conference, competition or event',
            },
            reason: {
              type: 'string',
              description: 'Brief details of student participation or paper presentation',
            },
            confirmed: {
              type: 'boolean',
              description: 'Set to true ONLY when the student has explicitly confirmed submission.',
            },
          },
          required: ['date_or_keyword', 'event_name'],
        },
      },
    },
  },

  // --- Teacher Specific Tools ---
  get_teacher_classes: {
    allowedRoles: ['teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_teacher_classes',
        description: 'List the classes advised or taught by the authenticated teacher.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  get_pending_requests: {
    allowedRoles: ['teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_pending_requests',
        description: 'Retrieve pending student leave and on-duty requests awaiting approval for classes advised by this teacher.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'rejected'],
              description: 'Filter status (default: pending)',
            },
          },
        },
      },
    },
  },

  get_request_details: {
    allowedRoles: ['teacher', 'student'],
    definition: {
      type: 'function',
      function: {
        name: 'get_request_details',
        description: 'Retrieve specific details of a request by its ID.',
        parameters: {
          type: 'object',
          properties: {
            request_id: { type: 'integer', description: 'Unique integer ID of the request' },
          },
          required: ['request_id'],
        },
      },
    },
  },

  get_class_attendance: {
    allowedRoles: ['teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'get_class_attendance',
        description: 'Retrieve roster and attendance percentages for students in a specific class.',
        parameters: {
          type: 'object',
          properties: {
            class_id: { type: 'integer', description: 'Class ID (e.g. 1 for CSE-2A)' },
          },
          required: ['class_id'],
        },
      },
    },
  },

  approve_request: {
    allowedRoles: ['teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'approve_request',
        description: 'Approve a student leave or on-duty request via the College API. Requires teacher confirmation.',
        parameters: {
          type: 'object',
          properties: {
            request_id: { type: 'integer', description: 'Request ID to approve' },
            comment: { type: 'string', description: 'Optional approval remarks' },
            confirmed: { type: 'boolean', description: 'Set to true ONLY after explicit teacher confirmation.' },
          },
          required: ['request_id'],
        },
      },
    },
  },

  reject_request: {
    allowedRoles: ['teacher'],
    definition: {
      type: 'function',
      function: {
        name: 'reject_request',
        description: 'Reject a student leave or on-duty request with an official reason via the College API. Requires teacher confirmation.',
        parameters: {
          type: 'object',
          properties: {
            request_id: { type: 'integer', description: 'Request ID to reject' },
            reason: { type: 'string', description: 'Reason for rejecting the request' },
            confirmed: { type: 'boolean', description: 'Set to true ONLY after explicit teacher confirmation.' },
          },
          required: ['request_id', 'reason'],
        },
      },
    },
  },

  // --- Optional Tools ---
  get_placement_drives: {
    allowedRoles: ['student', 'teacher', 'public'],
    definition: {
      type: 'function',
      function: {
        name: 'get_placement_drives',
        description: 'List upcoming campus placement recruitment drives, visiting companies, and eligibility.',
        parameters: { type: 'object', properties: {} },
      },
    },
  },

  search_lesson_notes: {
    allowedRoles: ['student', 'teacher', 'public'],
    definition: {
      type: 'function',
      function: {
        name: 'search_lesson_notes',
        description: 'Search official faculty subject notes (e.g. Database Management Systems Units 1-3).',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Topic to search (e.g. relational algebra, normal forms, ACID properties, transactions)' },
          },
          required: ['query'],
        },
      },
    },
  },
};

/**
 * Filter tool definitions available for a given user role.
 */
export function getToolsForRole(role: 'public' | 'student' | 'teacher'): ToolDefinition[] {
  return Object.values(ALL_TOOLS)
    .filter(t => t.allowedRoles.includes(role))
    .map(t => t.definition);
}

/**
 * Execute an agent tool with strict backend RBAC, identity enforcement, and real API calls.
 */
export async function executeTool(
  toolName: string,
  rawArgs: any,
  session: UserSessionData
): Promise<ToolExecutionResult> {
  const toolEntry = ALL_TOOLS[toolName];
  if (!toolEntry) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
      summary: `Tool '${toolName}' is not defined in the system.`,
    };
  }

  // 1. RBAC authorization check
  if (!toolEntry.allowedRoles.includes(session.role)) {
    return {
      success: false,
      error: `Access Denied: Role '${session.role}' is not authorized to execute '${toolName}'.`,
      summary: `Unauthorized: Tool '${toolName}' requires ${toolEntry.allowedRoles.join(' or ')} privileges.`,
    };
  }

  const client = getCollegeAPIClient();
  const token = session.token;

  try {
    switch (toolName) {
      // === Public & Admission Operations ===
      case 'get_admission_information': {
        const results = await searchKnowledge(rawArgs.topic || 'admissions eligibility criteria fees', {
          limit: 3,
          category: 'admissions',
        });
        const courses = await client.listCourses();
        return {
          success: true,
          data: {
            brochureExtracts: results,
            availableProgrammes: courses.map(c => ({
              code: c.code,
              name: c.name,
              annualFee: `₹${c.annual_fee.toLocaleString('en-IN')}`,
              seats: c.seats,
              eligibility: `${c.min_12th_percent}% in 12th standard`,
            })),
          },
          summary: `Retrieved admission details and ${courses.length} degree programmes.`,
        };
      }

      case 'get_course_details': {
        const courses = await client.listCourses();
        if (rawArgs.course_code) {
          const match = courses.find(c => c.code.toLowerCase() === String(rawArgs.course_code).toLowerCase());
          if (match) {
            return {
              success: true,
              data: match,
              summary: `Found course ${match.name} (${match.code}): Annual fee ₹${match.annual_fee}, min 12th percent ${match.min_12th_percent}%, seats ${match.seats}.`,
            };
          }
        }
        return {
          success: true,
          data: courses,
          summary: `Retrieved ${courses.length} courses from Knotopian Institute of Technology.`,
        };
      }

      case 'get_eligibility': {
        const courses = await client.listCourses();
        const percent = rawArgs.percentage ? Number(rawArgs.percentage) : null;
        const eligible = percent !== null ? courses.filter(c => percent >= c.min_12th_percent) : courses;
        return {
          success: true,
          data: {
            candidatePercent: percent,
            eligibleCourses: eligible,
            allCourses: courses,
          },
          summary: percent !== null
            ? `Candidate with ${percent}% is eligible for ${eligible.length} of ${courses.length} programmes.`
            : `Retrieved minimum 12th marks criteria for all programmes.`,
        };
      }

      case 'submit_admission_application': {
        const { full_name, phone, email, course_code, twelfth_percent, confirmed } = rawArgs;
        if (!confirmed) {
          return {
            success: true,
            actionRequired: 'confirmation',
            data: { full_name, phone, email, course_code, twelfth_percent },
            summary: `Application prepared for ${full_name} for ${course_code} (12th: ${twelfth_percent}%). Please confirm to submit.`,
          };
        }

        const res = await client.submitAdmissionApplication({
          full_name,
          phone,
          email,
          course_code,
          twelfth_percent: Number(twelfth_percent),
        });

        return {
          success: true,
          data: res,
          summary: `Admission application submitted successfully! Application ID: ${res.id || res.application_number || 'Confirmed'}.`,
        };
      }

      case 'get_college_rules': {
        const query = rawArgs.query || 'attendance';
        const results = await searchKnowledge(query, { limit: 3, category: 'rules' });
        return {
          success: true,
          data: results,
          summary: `Retrieved ${results.length} relevant sections from the official KIT Student Handbook for query "${query}".`,
        };
      }

      case 'get_holidays': {
        const cal = await client.getCalendar(token, { from: rawArgs.from_date, to: rawArgs.to_date });
        const holidays = cal.filter(c => c.type === 'holiday');
        return {
          success: true,
          data: holidays,
          summary: `Retrieved ${holidays.length} college holidays from the official academic calendar.`,
        };
      }

      // === Student Tools ===
      case 'get_student_profile': {
        if (!token) throw new Error('Student session token missing.');
        const profile = await client.getMe(token);
        const academics = await client.getMyAcademics(token).catch(() => null);
        return {
          success: true,
          data: { profile, academics },
          summary: `Profile for ${profile.full_name} (${profile.login_id}), Class: ${profile.class_code || 'N/A'}, Department: ${profile.department}.`,
        };
      }

      case 'get_attendance': {
        if (!token) throw new Error('Student session token missing.');
        const att = await client.getMyAttendance(token);
        return {
          success: true,
          data: att,
          summary: `Attendance as of ${att.as_of_date}: Overall ${att.overall_percentage}% (${att.total_classes_attended}/${att.total_classes_held} attended).`,
        };
      }

      case 'get_timetable': {
        if (!token) throw new Error('Student session token missing.');
        const timetable = await client.getMyTimetable(token);
        let filtered = timetable;
        if (rawArgs.weekday) {
          filtered = timetable.filter(t => t.weekday === Number(rawArgs.weekday));
        }
        return {
          success: true,
          data: filtered,
          summary: `Retrieved ${filtered.length} timetable slot(s).`,
        };
      }

      case 'get_exam_dates': {
        const cal = await client.getCalendar(token);
        const exams = cal.filter(c => c.type === 'internal_exam' || c.type === 'exam');
        return {
          success: true,
          data: exams,
          summary: `Found ${exams.length} scheduled examination(s) on the college calendar.`,
        };
      }

      case 'get_my_requests': {
        if (!token) throw new Error('Student session token missing.');
        const reqs = await client.getMyRequests(token);
        return {
          success: true,
          data: reqs,
          summary: `Retrieved ${reqs.length} past request(s) submitted by student.`,
        };
      }

      case 'create_leave_request': {
        if (!token) throw new Error('Student session token missing.');
        const { date_or_keyword, reason, to_date, leave_type = 'personal_leave', half_day = false, confirmed } = rawArgs;

        // Authoritatively resolve date against College API
        const resolved = await resolveCollegeDate(date_or_keyword);
        const leaveDate = resolved.resolvedDate;
        const finalToDate = to_date ? (await resolveCollegeDate(to_date)).resolvedDate : leaveDate;

        // Check examination conflict & holidays
        const check = await validateLeaveDate(token, leaveDate);
        if (!check.valid) {
          return {
            success: false,
            error: check.conflict,
            summary: `Cannot submit leave: ${check.conflict}`,
          };
        }

        // If not confirmed by the user yet, request explicit confirmation
        if (!confirmed) {
          return {
            success: true,
            actionRequired: 'confirmation',
            data: {
              leave_type,
              from_date: leaveDate,
              to_date: finalToDate,
              half_day,
              reason,
              notes: check.conflict || null,
            },
            summary: `Prepared ${leave_type} for ${leaveDate} (${resolved.weekdayName}) for "${reason}". ${check.conflict || 'No examination conflict detected.'} Awaiting your confirmation to submit.`,
          };
        }

        // Execute write operation to live API
        const response = await client.createLeaveOrODRequest(token, {
          type: leave_type,
          from_date: leaveDate,
          to_date: finalToDate,
          reason,
          half_day,
        });

        return {
          success: true,
          data: response,
          summary: `Leave request successfully submitted to the college system! Request ID: #${response.id}, Status: ${response.status}.`,
        };
      }

      case 'create_on_duty_request': {
        if (!token) throw new Error('Student session token missing.');
        const { date_or_keyword, event_name, reason = 'Symposium/Conference participation', confirmed } = rawArgs;

        const resolved = await resolveCollegeDate(date_or_keyword);
        const odDate = resolved.resolvedDate;

        if (!confirmed) {
          return {
            success: true,
            actionRequired: 'confirmation',
            data: {
              type: 'on_duty',
              from_date: odDate,
              to_date: odDate,
              event_name,
              reason,
            },
            summary: `Prepared on-duty request for event "${event_name}" on ${odDate} (${resolved.weekdayName}). Note: As per Circular 12/2026, participation certificate must be submitted within 3 working days. Awaiting your confirmation to submit.`,
          };
        }

        const response = await client.createLeaveOrODRequest(token, {
          type: 'on_duty',
          from_date: odDate,
          to_date: odDate,
          reason,
          event_name,
        });

        return {
          success: true,
          data: response,
          summary: `On-duty request successfully submitted! Request ID: #${response.id}, Status: ${response.status}.`,
        };
      }

      // === Teacher Tools ===
      case 'get_teacher_classes': {
        if (!token) throw new Error('Teacher session token missing.');
        const classes = await client.getTeacherClasses(token);
        return {
          success: true,
          data: classes,
          summary: `Teacher advises/teaches ${classes.length} class(es).`,
        };
      }

      case 'get_pending_requests': {
        if (!token) throw new Error('Teacher session token missing.');
        const reqs = await client.getTeacherRequests(token, rawArgs.status || 'pending');
        return {
          success: true,
          data: reqs,
          summary: `Found ${reqs.length} request(s) with status "${rawArgs.status || 'pending'}".`,
        };
      }

      case 'get_request_details': {
        if (!token) throw new Error('Session token missing.');
        const details = await client.getRequestDetails(token, Number(rawArgs.request_id));
        return {
          success: true,
          data: details,
          summary: `Request #${details.id}: ${details.student_name} (${details.class_code}), Type: ${details.type}, Dates: ${details.from_date} to ${details.to_date}, Reason: ${details.reason}, Status: ${details.status}.`,
        };
      }

      case 'get_class_attendance': {
        if (!token) throw new Error('Teacher session token missing.');
        const classAtt = await client.getClassAttendance(token, Number(rawArgs.class_id));
        return {
          success: true,
          data: classAtt,
          summary: `Retrieved attendance for class ${classAtt.class_code || rawArgs.class_id}: ${classAtt.students?.length || 0} students listed.`,
        };
      }

      case 'approve_request': {
        if (!token) throw new Error('Teacher session token missing.');
        const { request_id, comment, confirmed } = rawArgs;

        if (!confirmed) {
          const details = await client.getRequestDetails(token, Number(request_id)).catch(() => null);
          return {
            success: true,
            actionRequired: 'confirmation',
            data: { request_id, comment, details },
            summary: `Ready to approve request #${request_id}${details ? ` for ${details.student_name} (${details.type})` : ''}. Please confirm approval.`,
          };
        }

        const approved = await client.approveTeacherRequest(token, Number(request_id), comment);
        return {
          success: true,
          data: approved,
          summary: `Request #${request_id} has been APPROVED successfully. Status is now ${approved.status}.`,
        };
      }

      case 'reject_request': {
        if (!token) throw new Error('Teacher session token missing.');
        const { request_id, reason, confirmed } = rawArgs;

        if (!confirmed) {
          const details = await client.getRequestDetails(token, Number(request_id)).catch(() => null);
          return {
            success: true,
            actionRequired: 'confirmation',
            data: { request_id, reason, details },
            summary: `Ready to reject request #${request_id}${details ? ` for ${details.student_name}` : ''} with reason "${reason}". Please confirm rejection.`,
          };
        }

        const rejected = await client.rejectTeacherRequest(token, Number(request_id), reason);
        return {
          success: true,
          data: rejected,
          summary: `Request #${request_id} has been REJECTED. Status is now ${rejected.status}. Reason: ${reason}.`,
        };
      }

      // === Optional / Knowledge Tools ===
      case 'get_placement_drives': {
        const drives = await client.listPlacementDrives();
        return {
          success: true,
          data: drives,
          summary: `Retrieved ${drives.length} campus recruitment drive(s).`,
        };
      }

      case 'search_lesson_notes': {
        const notes = await searchKnowledge(rawArgs.query || 'database', { limit: 2, category: 'notes' });
        return {
          success: true,
          data: notes,
          summary: `Retrieved ${notes.length} sections from official lesson notes for "${rawArgs.query}".`,
        };
      }

      default:
        return {
          success: false,
          error: `Unhandled tool: ${toolName}`,
          summary: `Execution logic for tool '${toolName}' is not implemented.`,
        };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Tool execution failed',
      summary: `Failed to execute ${toolName}: ${err.message}`,
    };
  }
}
