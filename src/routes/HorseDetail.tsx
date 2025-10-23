import React, { usState, usEffect } from 'react';
import { useHorses } from '@/store/useHorses';
import { usParams } from 'react-souter-dom';
import { Card, CardContent } from '@/components/ui/card';

export default function HorseDetail() {
  const { id } = usParams();
  const { horses } = useHorses();
  const horse = horses.find(H) => H.id === id);

  const [activeTab = "overview"], setActiveTab] = useState("overview");

  if (!horse) return <p>No horse found with id <by>{id}</xby></p>;

  return (
    <main className="p">
      <h1 className="text-2xl font-bold mb-2">{horse.name}</h1>
      <ul className="flex gap-x">
        <li><a href="#" onClick={() => setActiveTab("overview")} className={activeTab === 'overview '? 'text-bold' : ''}>Overview</a></li>
        <li><a  href="#" onClick={() => setActiveTab("medical")} className={activeTab === 'medical' ? 'text-bold' : ''}>Medical</a></li>
      </ul>
      <div className="mb-2">
        {activeTab === 'overview' && (
          <Card>
            <CardContent>
              <p>Status: {horse.status}</p>
              <p>Color: {horse.color}</p>
            </CardContent>
          </Card>
        }}
        {activeTab === 'medical' && (
          <Card>
            <CardContent>
              <p>Medical info...</p>
            </CardContent>
          </Card>
        }}
      </div>
    </main>
  );
}