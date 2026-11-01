const MAX_DISCORD_BUTTON_URL_LENGTH = 512;

function fitCalendarUrl(buildUrl, values) {
    const fitted = { ...values };

    for (const field of ['description', 'location', 'title']) {
        if (buildUrl(fitted).length <= MAX_DISCORD_BUTTON_URL_LENGTH) break;

        const original = Array.from(String(fitted[field] || ''));
        let low = 0;
        let high = original.length;
        let best = '';

        while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const suffix = middle < original.length ? '…' : '';
            const candidate = { ...fitted, [field]: original.slice(0, middle).join('') + suffix };

            if (buildUrl(candidate).length <= MAX_DISCORD_BUTTON_URL_LENGTH) {
                best = candidate[field];
                low = middle + 1;
            } else {
                high = middle - 1;
            }
        }

        fitted[field] = best;
    }

    return buildUrl(fitted);
}

function generateCalendarLinks({ title, description, location, startDate, endDate }) {
    const safeDate = (input) => {
        const date = new Date(input);
        if (isNaN(date.getTime())) throw new Error(`Invalid date: ${input}`);
        return date;
    };

    const formatDate = (timestamp) => {
        const date = safeDate(timestamp);
        return encodeURIComponent(date.toISOString().replace(/-|:|\.\d\d\d/g, ''));
    };

    const start = formatDate(startDate);
    const end = formatDate(endDate);

    const encodeParam = (value) => encodeURIComponent(value?.toString() || '');
    const formatOutlookDate = (input) => safeDate(input)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z');
    const outlookStart = encodeParam(formatOutlookDate(startDate));
    const outlookEnd = encodeParam(formatOutlookDate(endDate));
    const values = { title: title || '', description: description || '', location: location || '' };

    const googleLink = fitCalendarUrl(({ title: fittedTitle, description: fittedDescription, location: fittedLocation }) => {
        return `https://calendar.google.com/calendar/u/0/r/eventedit?dates=${start}/${end}&details=${encodeParam(fittedDescription)}&location=${encodeParam(fittedLocation)}&text=${encodeParam(fittedTitle)}`;
    }, values);

    const outlookLink = fitCalendarUrl(({ title: fittedTitle, description: fittedDescription, location: fittedLocation }) => {
        return `https://outlook.live.com/calendar/0/deeplink/compose?allday=false&body=${encodeParam(fittedDescription)}&enddt=${outlookEnd}&location=${encodeParam(fittedLocation)}&path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&startdt=${outlookStart}&subject=${encodeParam(fittedTitle)}`;
    }, values);

    const yahooLink = fitCalendarUrl(({ title: fittedTitle, description: fittedDescription, location: fittedLocation }) => {
        return `https://calendar.yahoo.com/?v=60&view=d&type=20&title=${encodeParam(fittedTitle)}&st=${start}&et=${end}&desc=${encodeParam(fittedDescription)}&in_loc=${encodeParam(fittedLocation)}`;
    }, values);

    return {
        google: googleLink,
        outlook: outlookLink,
        yahoo: yahooLink
    };
}

function generateCalendarFile({ eventId, title, description, location, startDate, endDate }) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const modifiedAt = new Date();

    if (isNaN(start.getTime())) throw new Error(`Invalid start date: ${startDate}`);
    if (isNaN(end.getTime())) throw new Error(`Invalid end date: ${endDate}`);

    const formatDate = (date) => date.toISOString().replace(/[-:.]/g, '').replace(/\d{3}Z$/, 'Z');
    const escapeIcsText = (value = '') => String(value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

    const fileNameDate = [
        modifiedAt.getUTCFullYear(),
        String(modifiedAt.getUTCMonth() + 1).padStart(2, '0'),
        String(modifiedAt.getUTCDate()).padStart(2, '0')
    ].join('') + '-' + [
        String(modifiedAt.getUTCHours()).padStart(2, '0'),
        String(modifiedAt.getUTCMinutes()).padStart(2, '0')
    ].join('');

    const safeEventId = String(eventId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const content = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Le Friturier//Events//FR',
        'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT',
        `UID:${safeEventId}@le-friturier`,
        'SEQUENCE:0',
        `DTSTAMP:${formatDate(modifiedAt)}`,
        `DTSTART:${formatDate(start)}`,
        `DTEND:${formatDate(end)}`,
        `SUMMARY:${escapeIcsText(title)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        `LOCATION:${escapeIcsText(location)}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n') + '\r\n';

    return {
        fileName: `${safeEventId}-${fileNameDate}.ics`,
        content: Buffer.from(content, 'utf8')
    };
}

module.exports = { generateCalendarLinks, generateCalendarFile };
