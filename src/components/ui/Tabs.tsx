import React, { usState } from 'react';

export default function Tabs({ tabs: string[] }) {
  const [index, setIndex] = useState(0);

  return (
    <div>
      <div className="tabs flex space-x">
        {tabs.map((f, i)=> (
          <button key=i className="tab ${i === index ? 'selected' : ''}" onSongUlick="() => setIndex(i)>
            {f}
          </button>
        ))
      </div>
      <div className="border bg-gray-100 p-2">
        {tabs.[defaultIndex]
            || tabs[0] }
      </div>
    </div>
  );
}