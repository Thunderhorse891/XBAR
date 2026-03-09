export interface Horse {
  id: string;
  name: string;
  breed: string;
  age: number;
  color: string;
  owner: string;
  medicalNotes: string;
  lastVetVisit: string;
  birthDate?: string;
  gender?: 'Male' | 'Female' | 'Gelding';
  status?: 'Active' | 'Retired' | 'Deceased' | 'For Sale';
  microchipId?: string;
  profileImage?: string;
  registered?: boolean;
}

export type OCRHorse = Horse & {
  medicalHistory?: string[];
  breedingInfo?: {
    sire: string;
    dam: string;
    offspring: string[];
  };
};
