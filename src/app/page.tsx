import Link from 'next/link';
import { getCollegeAPIClient } from '@/lib/college-api';

export const revalidate = 60; // ISR 1 minute

export default async function HomePage() {
  const client = getCollegeAPIClient();

  let collegeInfo = {
    name: 'Knotopian Institute of Technology',
    code: 'KIT',
    tagline: 'Excellence in Engineering and Applied Technology',
    description:
      'Knotopian Institute of Technology (KIT) is an autonomous premier higher-education engineering institution in Tamil Nadu, recognized for high academic standards and industry placement.',
    contact: {
      phone: '+91 422 2619000',
      email: 'admissions@kit.ac.in',
      address: 'Knotopian Knowledge City, Coimbatore, Tamil Nadu 641042',
    },
  };

  let courses = [
    {
      id: 1,
      code: 'BTECH-CSE',
      name: 'B.Tech Computer Science and Engineering',
      department: 'CSE',
      min_12th_percent: 75.0,
      annual_fee: 125000.0,
      hostel_fee: 60000.0,
      seats: 120,
    },
    {
      id: 2,
      code: 'BTECH-ECE',
      name: 'B.Tech Electronics and Communication Engineering',
      department: 'ECE',
      min_12th_percent: 70.0,
      annual_fee: 110000.0,
      hostel_fee: 60000.0,
      seats: 60,
    },
    {
      id: 3,
      code: 'BTECH-MECH',
      name: 'B.Tech Mechanical Engineering',
      department: 'MECH',
      min_12th_percent: 60.0,
      annual_fee: 95000.0,
      hostel_fee: 55000.0,
      seats: 60,
    },
  ];

  let collegeDate = '2026-11-21';
  let apiHealthy = true;

  try {
    const [liveInfo, liveCourses, today] = await Promise.all([
      client.getCollegeInfo().catch(() => null),
      client.listCourses().catch(() => null),
      client.getToday().catch(() => null),
    ]);

    if (liveInfo) collegeInfo = liveInfo;
    if (liveCourses && liveCourses.length > 0) courses = liveCourses;
    if (today) collegeDate = today.date;
  } catch {
    apiHealthy = false;
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Hero Section */}
      <section className="bg-gradient-to-b from-[#0E625E] to-[#094340] text-white py-16 px-4 sm:px-6 lg:px-8 shadow-inner">
        <div className="max-w-5xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-800/80 border border-teal-600/50 text-xs text-teal-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Live Academic Session • Today: {collegeDate}</span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-tight">
            {collegeInfo.name}
          </h1>
          <p className="text-xl sm:text-2xl text-teal-100 font-light max-w-3xl mx-auto">
            {collegeInfo.tagline}
          </p>
          <p className="text-sm sm:text-base text-teal-200/90 max-w-2xl mx-auto leading-relaxed">
            {collegeInfo.description}
          </p>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/assistant"
              className="px-6 py-3.5 rounded-lg bg-[#F47F20] hover:bg-[#D66710] text-white font-bold text-base shadow-lg hover:shadow-orange-500/20 transition-all flex items-center gap-2 group"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 100-6 3 3 0 000 6z" />
              </svg>
              <span>Talk to KIT Assistant</span>
            </Link>

            <Link
              href="/login"
              className="px-6 py-3.5 rounded-lg bg-teal-800/60 hover:bg-teal-700/80 border border-teal-500/50 text-white font-semibold text-base transition-colors"
            >
              Student / Teacher Login
            </Link>
          </div>
        </div>
      </section>

      {/* Live System Capabilities Pill Bar */}
      <section className="bg-white border-b border-slate-200 py-3 px-4 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-slate-700">System Engines:</span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Groq LLM (openai/gpt-oss-120b)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Groq Whisper (whisper-large-v3-turbo)
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Live College API (ht.knowvally.com)
            </span>
          </div>

          <div className="text-slate-500 hidden md:block">
            Supports Voice, Text & Push-to-Talk
          </div>
        </div>
      </section>

      {/* Course Programmes Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 w-full">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#0E625E]">
            Degree Programmes Offered (2027–28)
          </h2>
          <p className="text-sm text-slate-600 mt-2">
            Real-time information queried directly from the Knotopian College API.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {courses.map((course) => (
            <div
              key={course.id}
              className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-teal-50 text-[#0E625E] border border-teal-200">
                    {course.code}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {course.seats} Seats Available
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 leading-snug">
                  {course.name}
                </h3>
                <p className="text-xs text-slate-500 mt-1">Department: {course.department}</p>

                <div className="mt-5 space-y-2 text-sm border-t border-slate-100 pt-4">
                  <div className="flex justify-between">
                    <span className="text-slate-500">12th Eligibility:</span>
                    <span className="font-semibold text-slate-800">Min {course.min_12th_percent}% aggregate</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Annual Tuition Fee:</span>
                    <span className="font-bold text-[#0E625E]">₹{course.annual_fee.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Hostel Fee:</span>
                    <span className="font-semibold text-slate-700">₹{course.hostel_fee.toLocaleString('en-IN')}/year</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <Link
                  href={`/assistant?q=Tell me about the eligibility and admission process for ${course.name}`}
                  className="w-full block text-center py-2 px-3 rounded-lg bg-teal-50 hover:bg-teal-100 text-[#0E625E] text-xs font-semibold transition-colors"
                >
                  Enquire via Voice Assistant →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* User Guides & Quick Questions */}
      <section className="bg-slate-100/70 border-t border-slate-200 py-12 px-4 sm:px-6 lg:px-8 mt-auto">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-center text-slate-800 mb-8">
            Try Asking the KIT Assistant
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="inline-block px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-bold text-xs mb-2">
                Public / Prospective Students
              </span>
              <p className="text-xs text-slate-500 mb-3">No login required. Explore courses and admissions.</p>
              <ul className="space-y-2 text-slate-700">
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=What courses are available at KIT and what are the fees?">
                    "What courses are available and what are the fees?"
                  </Link>
                </li>
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=I scored 78 percent in 12th standard. Am I eligible for Computer Science?">
                    "I scored 78% in 12th. Am I eligible for CSE?"
                  </Link>
                </li>
              </ul>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="inline-block px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-xs mb-2">
                Enrolled Students
              </span>
              <p className="text-xs text-slate-500 mb-3">Log in as Arjun (CSE-2A) to test.</p>
              <ul className="space-y-2 text-slate-700">
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=What is my current attendance percentage?">
                    "What is my current attendance percentage?"
                  </Link>
                </li>
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=I need leave tomorrow for personal work">
                    "I need leave tomorrow for personal work."
                  </Link>
                </li>
              </ul>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200">
              <span className="inline-block px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-bold text-xs mb-2">
                Teachers / Advisors
              </span>
              <p className="text-xs text-slate-500 mb-3">Log in as Dr. Lakshmi (Class Advisor) to test.</p>
              <ul className="space-y-2 text-slate-700">
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=Show my pending student leave requests">
                    "Show my pending student leave requests."
                  </Link>
                </li>
                <li className="p-2 bg-slate-50 rounded hover:bg-teal-50 cursor-pointer">
                  <Link href="/assistant?q=What is the attendance of class CSE-2A?">
                    "Show attendance for class CSE-2A."
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
