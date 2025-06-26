import React from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, orderBy, where, getDocs } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Denna konfiguration hämtas nu säkert från Netlify
const firebaseConfig = {
  apiKey: import.meta.env.VITE_API_KEY,
  authDomain: import.meta.env.VITE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_APP_ID
};

// --- Main App Component ---
function App() {
    const [db, setDb] = React.useState(null);
    const [authStatus, setAuthStatus] = React.useState('pending');
    const [selectedMember, setSelectedMember] = React.useState(null);
    const [activities, setActivities] = React.useState([]);
    const [fixedActivities, setFixedActivities] = React.useState([]);
    const [checkedTasks, setCheckedTasks] = React.useState(new Set());
    const [messages, setMessages] = React.useState([]);
    const [isLoading, setIsLoading] = React.useState(true);
    const [notificationPermission, setNotificationPermission] = React.useState('default');
    const [sentNotifications, setSentNotifications] = React.useState(new Set());
    
    const familyMembers = ["Pappa", "Mamma", "Leo", "Molly", "Ofelia", "Aron"];

    React.useEffect(() => {
        if ('Notification' in window) setNotificationPermission(Notification.permission);
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const auth = getAuth(app);
            setDb(firestoreDb);
            
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    setAuthStatus('signedIn');
                } else {
                    signInAnonymously(auth).catch(error => {
                        console.error("Anonymous sign-in failed:", error);
                        setAuthStatus('error');
                    });
                }
            });

        } catch (error) {
            console.error("Error initializing Firebase:", error);
            setAuthStatus('error');
        }
    }, []);

    React.useEffect(() => {
        if (authStatus !== 'signedIn' || !db) return;
        
        const todayStr = new Date().toISOString().split('T')[0];

        const actUnsubscribe = onSnapshot(query(collection(db, "activities")), (snapshot) => {
            setActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => new Date(a.date) - new Date(b.date)));
            setIsLoading(false); // Set loading to false after first data load
        });
        const fixedActUnsubscribe = onSnapshot(query(collection(db, "fixed_activities")), (snapshot) => {
            setFixedActivities(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        const checkedUnsubscribe = onSnapshot(query(collection(db, "checked_tasks"), where("date", "==", todayStr)), (snapshot) => {
            setCheckedTasks(new Set(snapshot.docs.map(doc => doc.data().taskId)));
        });
        const msgUnsubscribe = onSnapshot(query(collection(db, "messages"), orderBy("timestamp", "asc")), (snapshot) => {
            setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });

        return () => { actUnsubscribe(); fixedActUnsubscribe(); checkedUnsubscribe(); msgUnsubscribe(); };
    }, [authStatus, db]);

    React.useEffect(() => {
        if (notificationPermission !== 'granted') return;
        const intervalId = setInterval(() => {
            const now = new Date();
            const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
            const todayStr = now.toISOString().split('T')[0];
            
            const allActivities = [
                ...activities.map(a => ({...a, type: 'regular'})),
                ...fixedActivities.map(a => ({...a, type: 'fixed'}))
            ];

            allActivities.forEach(activity => {
                let activityDate;
                let notificationId = activity.id;
                let body = `${activity.member}: ${activity.text}`;

                if (activity.type === 'regular' && activity.date) {
                    activityDate = new Date(activity.date);
                    body += ` kl ${activityDate.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })}`;
                } else if (activity.type === 'fixed' && activity.time) {
                    notificationId = `${activity.id}-${todayStr}`;
                    const [hours, minutes] = activity.time.split(':');
                    activityDate = new Date();
                    activityDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
                    body += ` kl ${activity.time}`;
                }

                if (activityDate && activityDate > now && activityDate <= oneHourFromNow && !sentNotifications.has(notificationId)) {
                    new Notification('Påminnelse', { body });
                    setSentNotifications(prev => new Set(prev).add(notificationId));
                }
            });
        }, 60000);
        return () => clearInterval(intervalId);
    }, [activities, fixedActivities, notificationPermission, sentNotifications]);

    const handleAddActivity = async (newActivity) => { if (db) await addDoc(collection(db, "activities"), { ...newActivity, type: 'regular' }); };
    const handleAddFixedActivity = async (newActivity) => { if (db) await addDoc(collection(db, "fixed_activities"), { ...newActivity, type: 'fixed' }); };
    const handleDeleteActivity = async (id) => { if (db) await deleteDoc(doc(db, "activities", id)); };
    const handleDeleteFixedActivity = async (id) => { if (db) await deleteDoc(doc(db, "fixed_activities", id)); };
    const handleToggleCheck = async (taskId, isChecked) => {
        if (!db) return;
        const todayStr = new Date().toISOString().split('T')[0];
        const collectionRef = collection(db, "checked_tasks");
        if (!isChecked) {
            await addDoc(collectionRef, { taskId, date: todayStr, member: selectedMember });
        } else {
            const q = query(collectionRef, where("taskId", "==", taskId), where("date", "==", todayStr));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(docSnapshot => deleteDoc(doc(db, "checked_tasks", docSnapshot.id)));
        }
    };
    const handleSendMessage = async (text) => { if (db && text.trim()) await addDoc(collection(db, "messages"), { text, member: selectedMember, timestamp: new Date().toISOString() }); };

    return (
        <div className="bg-gray-100 min-h-screen font-sans text-gray-800 p-4 sm:p-6 md:p-8">
            <div className="max-w-7xl mx-auto">
                <header className="mb-6 text-center"><h1 className="text-4xl md:text-5xl font-bold text-indigo-600">Familjekalender</h1><p className="text-gray-500 mt-2">Planering, påminnelser och chatt för hela familjen.</p></header>
                {!selectedMember ? <UserSelection onSelect={setSelectedMember} members={familyMembers} /> : (
                    <>
                        <div className="flex justify-center items-center mb-6"><h2 className="text-2xl font-bold text-center">Välkommen, <span className="text-indigo-600">{selectedMember}!</span></h2><button onClick={() => setSelectedMember(null)} className="ml-4 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 transition">Byt användare</button></div>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                            <AddActivityForm onAddActivity={handleAddActivity} selectedMember={selectedMember} />
                            <ScheduleView title={`${selectedMember}s Schema`} activities={activities.filter(a => a.member === selectedMember)} onDelete={handleDeleteActivity} canDelete={true} />
                            <FixedActivitiesList activities={fixedActivities.filter(a => a.member === selectedMember)} onAdd={handleAddFixedActivity} onDelete={handleDeleteFixedActivity} onToggle={handleToggleCheck} checkedTasks={checkedTasks} selectedMember={selectedMember} />
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-8">
                           <div className="lg:col-span-2">
                                <ChatView messages={messages} currentUser={selectedMember} />
                                <ChatMessageForm onSendMessage={handleSendMessage} />
                            </div>
                            <div className="lg:col-span-3">
                                 <CalendarView activities={activities} fixedActivities={fixedActivities} />
                            </div>
                        </div>
                    </>
                )}
                {isLoading && <p className="text-center text-lg text-gray-500 mt-8">Laddar kalender...</p>}
            </div>
        </div>
    );
}

function CalendarView({ activities, fixedActivities }) {
    const [currentDate, setCurrentDate] = React.useState(new Date());
    const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
    const startDayOfWeek = (startOfMonth.getDay() + 6) % 7;
    const goToPreviousMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    const goToNextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    const dayHeaders = ['Mån', 'Tis', 'Ons', 'Tors', 'Fre', 'Lör', 'Sön'];
    const calendarDays = Array.from({ length: startDayOfWeek }, (_, i) => <div key={`empty-${i}`} className="border-t border-r border-gray-200"></div>);
    
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
        const dayDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        const dayActivities = activities.filter(act => new Date(act.date).toDateString() === dayDate.toDateString());
        calendarDays.push(
            <div key={day} className="border-t border-r border-gray-200 p-2 min-h-[120px] flex flex-col">
                <span className="font-bold self-start mb-1">{day}</span>
                <div className="flex-grow overflow-y-auto space-y-1 text-xs">
                    {dayActivities.map(act => (
                        <div key={act.id} className="p-1 rounded-md bg-green-200 text-green-800">
                           <span className="font-semibold">{act.member}:</span> {act.text}
                        </div>
                    ))}
                    {fixedActivities.map(act => (
                        <div key={act.id} className="p-1 rounded-md bg-blue-200 text-blue-800">
                           <span className="font-semibold">{act.time ? `(${act.time})` : ''} {act.member}:</span> {act.text}
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    return (
        <div className="bg-white p-4 sm:p-6 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-4"><button onClick={goToPreviousMonth} className="p-2 rounded-full hover:bg-gray-200">&lt;</button><h3 className="text-xl font-bold text-gray-800">{currentDate.toLocaleString('sv-SE', { month: 'long', year: 'numeric' })}</h3><button onClick={goToNextMonth} className="p-2 rounded-full hover:bg-gray-200">&gt;</button></div>
            <div className="grid grid-cols-7 border-l border-b border-gray-200">{dayHeaders.map(h => <div key={h} className="text-center font-bold p-2 border-t border-r border-gray-200 bg-gray-50">{h}</div>)}{calendarDays}</div>
        </div>
    );
}

function FixedActivitiesList({ activities, onAdd, onDelete, onToggle, checkedTasks, selectedMember }) {
    const [text, setText] = React.useState('');
    const [time, setTime] = React.useState('');
    const handleSubmit = (e) => {
        e.preventDefault();
        if(!text.trim()) return;
        onAdd({ text, time, member: selectedMember });
        setText('');
        setTime('');
    };

    const sortedActivities = React.useMemo(() => {
        return [...activities].sort((a, b) => {
            const aIsChecked = checkedTasks.has(a.id);
            const bIsChecked = checkedTasks.has(b.id);
            if (aIsChecked === bIsChecked) return 0;
            return aIsChecked ? 1 : -1;
        });
    }, [activities, checkedTasks]);

    return (
        <div className="bg-white p-6 rounded-xl shadow-md h-full">
            <h3 className="text-xl font-bold mb-4 text-gray-700">Fasta Aktiviteter (Dagliga)</h3>
            <form onSubmit={handleSubmit} className="space-y-3 mb-4">
                <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Ny fast aktivitet..." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                <div className="flex gap-2">
                    <input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/>
                    <button type="submit" className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition">Lägg till</button>
                </div>
            </form>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {sortedActivities.map(act => {
                    const isChecked = checkedTasks.has(act.id);
                    return (
                        <div key={act.id} className={`flex items-center justify-between p-2 rounded-lg ${isChecked ? 'bg-gray-200' : 'bg-blue-50'}`}>
                           <div className="flex items-center">
                               <input type="checkbox" checked={isChecked} onChange={() => onToggle(act.id, isChecked)} className="h-5 w-5 rounded text-indigo-600 focus:ring-indigo-500 border-gray-300 mr-3"/>
                               <div>
                                 <span className={`${isChecked ? 'line-through text-gray-500' : ''}`}>{act.text}</span>
                                 {act.time && <span className={`text-xs ml-2 ${isChecked ? 'text-gray-400' : 'text-blue-600'}`}>{act.time}</span>}
                               </div>
                           </div>
                           <button onClick={() => onDelete(act.id)} className="text-red-400 hover:text-red-600 font-bold text-xl">&times;</button>
                        </div>
                    );
                })}
                 {activities.length === 0 && <p className="text-gray-400 text-center py-4">Inga fasta aktiviteter tillagda.</p>}
            </div>
        </div>
    );
}

function ChatView({ messages, currentUser }) {
    const chatEndRef = React.useRef(null);
    React.useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
    return (
        <div className="bg-white p-6 rounded-xl shadow-md h-[250px] flex flex-col">
            <h3 className="text-xl font-bold mb-4 text-gray-700 border-b pb-2">Familjechatt</h3>
            <div className="flex-grow overflow-y-auto pr-2 space-y-4">{messages.map(msg => (<div key={msg.id} className={`flex flex-col ${msg.member === currentUser ? 'items-end' : 'items-start'}`}><div className={`px-4 py-2 rounded-2xl max-w-xs lg:max-w-md ${msg.member === currentUser ? 'bg-indigo-500 text-white' : 'bg-gray-200 text-gray-800'}`}><p>{msg.text}</p></div></div>))}<div ref={chatEndRef} /></div>
        </div>
    );
}

function ChatMessageForm({ onSendMessage }) {
    const [text, setText] = React.useState('');
    const handleSubmit = (e) => { e.preventDefault(); onSendMessage(text); setText(''); };
    return (<form onSubmit={handleSubmit} className="mt-4 flex gap-2"><input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Skriv ett meddelande..." className="flex-grow px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500"/><button type="submit" className="bg-indigo-600 text-white font-bold py-2 px-6 rounded-full hover:bg-indigo-700 transition">Skicka</button></form>);
}

function UserSelection({ onSelect, members }) {
    return (<div className="bg-white p-8 rounded-xl shadow-lg max-w-md mx-auto"><h2 className="text-2xl font-semibold text-center mb-6">Vem är du?</h2><div className="grid grid-cols-2 sm:grid-cols-3 gap-4">{members.map(member => <button key={member} onClick={() => onSelect(member)} className="p-4 bg-indigo-500 text-white font-bold rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-transform transform hover:scale-105">{member}</button>)}</div></div>);
}

function AddActivityForm({ onAddActivity, selectedMember }) {
    const [text, setText] = React.useState('');
    const [date, setDate] = React.useState('');
    const [time, setTime] = React.useState('');
    const handleSubmit = (e) => { e.preventDefault(); if (!text || !date || !time) return; onAddActivity({ text, date: `${date}T${time}`, member: selectedMember }); setText(''); setDate(''); setTime(''); };
    return (
        <div className="bg-white p-6 rounded-xl shadow-md h-full">
            <h3 className="text-xl font-bold mb-4 text-gray-700">Lägg till Händelse</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div><label htmlFor="activity-text" className="block text-sm font-medium text-gray-600 mb-1">Händelse:</label><input id="activity-text" type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="T.ex. Kalas hos farmor" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div>
                <div className="flex gap-4"><div className="w-1/2"><label htmlFor="activity-date" className="block text-sm font-medium text-gray-600 mb-1">Datum:</label><input id="activity-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div><div className="w-1/2"><label htmlFor="activity-time" className="block text-sm font-medium text-gray-600 mb-1">Tid:</label><input id="activity-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"/></div></div>
                <button type="submit" className="w-full bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600 transition">Lägg till Händelse</button>
            </form>
        </div>
    );
}

function ScheduleView({ title, activities, onDelete, canDelete }) {
    const formatDateTime = (d) => new Date(d).toLocaleString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return (
        <div className="bg-white p-6 rounded-xl shadow-md h-full">
            <h3 className="text-xl font-bold mb-4 text-gray-700">{title}</h3>
            <div className="space-y-3 max-h-48 overflow-y-auto pr-2">{activities.length === 0 ? <p className="text-gray-500">Inga händelser planerade.</p> : activities.map(act => (<div key={act.id} className="bg-gray-50 p-3 rounded-lg flex justify-between items-center border-l-4 border-green-400"><div><p className="font-semibold">{act.text}</p><p className="text-sm text-gray-500">{formatDateTime(act.date)}</p></div>{canDelete && <button onClick={() => onDelete(act.id)} className="text-red-500 hover:text-red-700 font-bold transition-colors text-xl" aria-label="Ta bort aktivitet">&times;</button>}</div>))}</div>
        </div>
    );
}

export default App;
