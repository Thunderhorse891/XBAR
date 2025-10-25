export interface Horse {
  id: number;
  name: string;
  breed: string;
  age: number;
  color: string;
  owner: string;
  medicalNotes: string;
  lastVetVisit: string;
}
interface Horse {
  id: number;
  name: string;
  breed: string;
  age: number;
  color: string;
  owner: string;
  medicalNotes: string;
  lastVetVisit: string;
  
  // Optional additions for future features:
  birthDate?: Date;           // More precise than age
  gender?: 'Male' | 'Female' | 'Gelding';
  status?: 'Active' | 'Retired' | 'Deceased';
  microchipId?: string;       // For tracking
  profileImage?: string;      // Horse photos
}
