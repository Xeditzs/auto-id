export const documentTypes = {
  registration: 'Registration certificate',
  insurance: 'Insurance policy',
  emissions: 'Emissions certificate'
};

const dayMs = 86_400_000;
export function dateAt(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function care(vehicle, documents, today) {
  const checks = Object.entries(documentTypes).map(([type, label]) => {
    const document = documents.find(item => item.type === type);
    const remaining = document ? (Date.parse(document.expiry) - Date.parse(today)) / dayMs : null;
    const status = remaining === null ? 'Missing' : remaining < 0 ? 'Expired' : remaining <= 30 ? 'Due soon' : 'Current';
    return { type, label, remaining, status, points: status === 'Current' ? 20 : status === 'Due soon' ? 10 : 0, max: 20 };
  });
  const remaining = vehicle.last_service_km + vehicle.interval_km - vehicle.odometer;
  const status = remaining <= 0 ? 'Due' : remaining <= 500 ? 'Due soon' : 'On track';
  const service = { label: 'Scheduled service', remaining, status, points: status === 'On track' ? 40 : status === 'Due soon' ? 20 : 0, max: 40 };
  return { checks, service, score: checks.reduce((sum, check) => sum + check.points, service.points) };
}
