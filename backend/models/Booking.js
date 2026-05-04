const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  zoneId:             { type: String, required: true, index: true },
  zoneName:           { type: String, required: true },
  eventName:          { type: String, required: true },
  organizer:          { type: String, required: true },
  expectedAttendance: { type: Number, required: true, min: 1 },
  startTime:          { type: Date, required: true },
  endTime:            { type: Date, required: true },
  status: {
    type: String,
    enum: ['upcoming', 'active', 'completed', 'cancelled'],
    default: 'upcoming'
  }
}, { timestamps: true });

// Overlap check — returns true if two bookings share any time window
bookingSchema.statics.hasConflict = async function(zoneId, startTime, endTime, excludeId = null) {
  const query = {
    zoneId,
    status: { $nin: ['cancelled', 'completed'] },
    startTime: { $lt: new Date(endTime) },
    endTime:   { $gt: new Date(startTime) }
  };
  if (excludeId) query._id = { $ne: excludeId };
  const count = await this.countDocuments(query);
  return count > 0;
};

module.exports = mongoose.model('Booking', bookingSchema);
