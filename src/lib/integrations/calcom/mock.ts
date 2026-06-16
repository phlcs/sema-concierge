import type { CalcomAdapter, Slot, BookingInput, BookingOutput } from './types'

const ALL_SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00']

function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

function pickOccupied(slots: string[]): Set<string> {
  const occupied = new Set<string>()
  // Mark 1-2 random slots as occupied for realism
  const count = Math.floor(Math.random() * 2) + 1
  const shuffled = [...slots].sort(() => Math.random() - 0.5)
  for (let i = 0; i < count; i++) occupied.add(shuffled[i])
  return occupied
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 10)
}

export const calcomMock: CalcomAdapter = {
  async listAvailableSlots(date: Date): Promise<Slot[]> {
    if (isWeekend(date)) return []
    const occupied = pickOccupied(ALL_SLOTS)
    return ALL_SLOTS.map((time) => ({ time, available: !occupied.has(time) }))
  },

  async createBooking(input: BookingInput): Promise<BookingOutput> {
    const id = `mock-cal-${crypto.randomUUID()}`
    const slug = slugify(input.userName)
    const meetUrl = `https://meet.google.com/mock-${slug}-${id.slice(-6)}`
    return { id, meetUrl }
  },

  async cancelBooking(_id: string): Promise<void> {
    // no-op in mock
  },
}
