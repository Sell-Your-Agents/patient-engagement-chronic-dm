"""Indian names on calls: the speech-to-text name boost, and the misheard-name matcher.

Two jobs, one name file:
1. STT_KEYTERMS: a short list of common names sent to Deepgram, so it hears them right (stt_service.py).
2. IndianNameMatcher: fixes names Deepgram still gets wrong (below).

Phone audio (8 kHz) often turns Indian names into English-looking words: "sir ish" for Suresh,
"lux me" for Lakshmi, "bouncy" for Vamsi. After the agent asks for a name, the caller's reply is
checked against a list of Indian names by sound (a consonant "sound key") and by spelling. If a word
looks like a misheard name, the agent gets a private hint (never spoken) with the likely names.

The agent still reads the name back and asks "is that correct?" (see PATIENT NAME in
inbound_prompts.py), so a wrong suggestion is caught by the caller; nothing is ever saved from here.

Usage:
    from app.services.agent.indian_name_matcher import name_matcher
    name_matcher.match_name("Tarfik")            # [("Karthik", 0.8), ...]
    name_matcher.build_llm_name_hint("sir ish")  # "NAME CHECK: ... 'sir ish' may be Suresh ..."
"""
import re
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

# ==============================================================================
# 1. NAME LISTS
# ==============================================================================

# South Indian (Telugu, Tamil, Kannada, Malayalam)
SOUTH_INDIAN_NAMES: List[str] = [
    # Male
    'Aarav', 'Abhilash', 'Abhinav', 'Abhishek', 'Adarsh', 'Aditya', 'Advait', 'Ajay', 'Akhil', 'Akshay', 'Amar', 'Amarnath', 'Amit', 'Amogh', 'Anand', 'Ananth', 'Anil', 'Anirudh', 'Anish', 'Anjan', 'Anjaneyulu', 'Ankit', 'Ankush', 'Anoop', 'Anudeep', 'Anurag', 'Apparao', 'Aravind', 'Arjun', 'Arun', 'Arvind', 'Ashish', 'Ashok', 'Ashwin', 'Avinash', 'Babu', 'Baburao', 'Balaji', 'Balaram', 'Bhanu', 'Bharath', 'Bhargav', 'Bhaskar', 'Bhavan', 'Bheem', 'Bhupathi', 'Chaitanya', 'Chakradhar', 'Chakri', 'Chandan', 'Chandra', 'Chandrasekhar', 'Charan', 'Chetan', 'Chinna', 'Chiranjeevi', 'Damodar', 'Darshan', 'Dattatreya', 'Deepak', 'Dev', 'Deva', 'Devendra', 'Dhanush', 'Dharma', 'Dheeraj', 'Dilip', 'Dinesh', 'Divakar', 'Durga', 'Durgaprasad', 'Eshwar', 'Gajendra', 'Ganesh', 'Gangadhar', 'Gautam', 'Giridhar', 'Girish', 'Gopal', 'Gopi', 'Gopikrishna', 'Goutham', 'Govardhan', 'Govind', 'Guru', 'Gurumurthy', 'Harish', 'Harsha', 'Harshavardhan', 'Hemanth', 'Himanshu', 'Hrithik', 'Indra', 'Jagadeesh', 'Jagadish', 'Jagan', 'Jai', 'Jaideep', 'Janardhan', 'Jaswanth', 'Jay', 'Jayakumar', 'Jayanth', 'Jayaprakash', 'Jeevan', 'Jitendra', 'Kailash', 'Kalyan', 'Kamal', 'Kamalakar', 'Kamesh', 'Kanak', 'Karthik', 'Karthikeya', 'Kasi', 'Kaushik', 'Keshav', 'Kiran', 'Kishore', 'Koti', 'Kranthi', 'Krishna', 'Krishnamraju', 'Krishnamurthy', 'Kumar', 'Kushal', 'Lakshman', 'Lakshminarayana', 'Lalith', 'Lokesh', 'Madhav', 'Madhu', 'Madhusudhan', 'Mahendra', 'Mahesh', 'Mallikarjun', 'Mani', 'Manideep', 'Manikanta', 'Manish', 'Manohar', 'Manoj', 'Maruthi', 'Mohan', 'Mohanrao', 'Mouli', 'Mukesh', 'Murali', 'Muralikrishna', 'Murthy', 'Naga', 'Nagaraj', 'Nagaraju', 'Nagendra', 'Nagesh', 'Nageswararao', 'Nanda', 'Nandakishore', 'Nandan', 'Narasimha', 'Narasimharao', 'Narayana', 'Narendra', 'Naresh', 'Naveen', 'Navneet', 'Nihal', 'Nikhil', 'Nilesh', 'Niranjan', 'Nishanth', 'Nithin', 'Omkar', 'Padmanabhan', 'Pavan', 'Pavankumar', 'Phani', 'Phanindra', 'Prabhakar', 'Prabhath', 'Prabhu', 'Pradeep', 'Pradyumna', 'Prahlad', 'Prajwal', 'Prakash', 'Pramod', 'Pranav', 'Pranay', 'Prasad', 'Prashanth', 'Pratap', 'Praveen', 'Prem', 'Premkumar', 'Prithvi', 'Puneeth', 'Purushotham', 'Raghav', 'Raghava', 'Raghavendra', 'Raghu', 'Raghuram', 'Rahul', 'Raj', 'Raja', 'Rajasekhar', 'Rajeev', 'Rajendra', 'Rajesh', 'Rajeshwar', 'Rajiv', 'Raju', 'Rakesh', 'Ram', 'Rama', 'Ramachandra', 'Ramakrishna', 'Ramana', 'Ramanjaneyulu', 'Ramesh', 'Ramkumar', 'Ramu', 'Ranga', 'Rangarao', 'Ranjith', 'Rathan', 'Ratnakar', 'Ravi', 'Ravichandra', 'Ravikumar', 'Ravindra', 'Raviteja', 'Rishi', 'Rithvik', 'Rohan', 'Rohit', 'Roopesh', 'Roshan', 'Rudra', 'Sagar', 'Sahil', 'Sai', 'Saicharan', 'Saikiran', 'Saikumar', 'Sainath', 'Saiprasad', 'Saiteja', 'Sajjan', 'Saketh', 'Samrat', 'Sandeep', 'Sanjay', 'Sanjeev', 'Sankalp', 'Sankar', 'Sankara', 'Santhosh', 'Sarath', 'Saravanan', 'Sasidhar', 'Satish', 'Satya', 'Satyanarayana', 'Satyaprasad', 'Saurabh', 'Sekhar', 'Seshadri', 'Seshu', 'Shankar', 'Shanmukh', 'Sharath', 'Shashank', 'Shashi', 'Shirish', 'Sirish', 'Shiva', 'Shivaji', 'Shivakumar', 'Shivanand', 'Shravan', 'Shreyas', 'Shyam', 'Siddharth', 'Siddhartha', 'Siva', 'Sivakumar', 'Sivaprasad', 'Sivaram', 'Sivareddy', 'Sohan', 'Somasekhar', 'Someswar', 'Sravan', 'Sree', 'Sreedhar', 'Sreekanth', 'Sreenivas', 'Sreenivasulu', 'Sreeram', 'Sri', 'Sridhar', 'Srihari', 'Srikanth', 'Srinath', 'Srinivas', 'Srinivasarao', 'Sriram', 'Subbarao', 'Subhash', 'Subrahmanyam', 'Subramanyam', 'Sudhakar', 'Sudheer', 'Suhas', 'Suman', 'Sumanth', 'Sumit', 'Sundar', 'Sunil', 'Suraj', 'Surendra', 'Suresh', 'Surya', 'Suryanarayana', 'Suryaprakash', 'Sushanth', 'Swamy', 'Tarun', 'Teja', 'Tejas', 'Thirupathi', 'Tilak', 'Tirumala', 'Tirupati', 'Trinath', 'Uday', 'Udaykumar', 'Umamahesh', 'Umesh', 'Upendra', 'Vamshi', 'Vamsi', 'Vamsikrishna', 'Varun', 'Vasant', 'Vasanth', 'Vasu', 'Vasudev', 'Veera', 'Veerabhadra', 'Veeraraju', 'Venkat', 'Venkata', 'Venkatachalam', 'Venkataramana', 'Venkatarao', 'Venkatesh', 'Venkateswarlu', 'Venu', 'Venugopal', 'Vicky', 'Vidyasagar', 'Vignesh', 'Vihaan', 'Vijay', 'Vijayakumar', 'Vikas', 'Vikram', 'Vinay', 'Vinayak', 'Vineeth', 'Vinith', 'Vinod', 'Vishal', 'Vishnu', 'Vishwanath', 'Vivek', 'Yash', 'Yashwanth', 'Yogesh', 'Yugandhar',
    # Female
    'Aadhya', 'Aaradhya', 'Aarti', 'Abhinaya', 'Abhirami', 'Aditi', 'Aishwarya', 'Akhila', 'Akshara', 'Akshaya', 'Alekhya', 'Amala', 'Ambika', 'Amrutha', 'Anagha', 'Ananya', 'Anasuya', 'Anitha', 'Anjali', 'Anjana', 'Ankitha', 'Annapurna', 'Anu', 'Anuhya', 'Anupama', 'Anuradha', 'Anusha', 'Anushka', 'Aparna', 'Apoorva', 'Archana', 'Aruna', 'Arundhati', 'Asha', 'Ashwini', 'Avanthi', 'Bala', 'Bhanupriya', 'Bharathi', 'Bhargavi', 'Bhavana', 'Bhavani', 'Bhavya', 'Bindu', 'Brinda', 'Chaitra', 'Chandana', 'Chandini', 'Chandrika', 'Charitha', 'Charulatha', 'Chaya', 'Chitra', 'Daksha', 'Deepa', 'Deepika', 'Deepthi', 'Devi', 'Devika', 'Dhanalakshmi', 'Dhanya', 'Dharani', 'Divya', 'Eshwari', 'Ganga', 'Gayathri', 'Geetha', 'Geethanjali', 'Girija', 'Gowri', 'Gowthami', 'Harika', 'Harini', 'Haritha', 'Harshitha', 'Hema', 'Hemalatha', 'Himabindu', 'Indira', 'Indu', 'Indumathi', 'Jahnavi', 'Jaya', 'Jayalakshmi', 'Jayanthi', 'Jayasree', 'Jhansi', 'Joshna', 'Jyothi', 'Jyothsna', 'Kalyani', 'Kamakshi', 'Kamala', 'Kameswari', 'Kanaka', 'Kanchana', 'Kanya', 'Karthika', 'Kasturi', 'Kaveri', 'Kavitha', 'Kavya', 'Keerthana', 'Keerthi', 'Kokila', 'Komal', 'Komali', 'Kousalya', 'Krishnaveni', 'Krupa', 'Kumari', 'Kusuma', 'Lakshmi', 'Lakshmiprasanna', 'Lalitha', 'Lasya', 'Latha', 'Lavanya', 'Leela', 'Leelavathi', 'Lekha', 'Likitha', 'Lohitha', 'Madhavi', 'Madhulika', 'Madhumathi', 'Madhuri', 'Maha', 'Mahalakshmi', 'Maheswari', 'Malathi', 'Malavika', 'Mallika', 'Mamatha', 'Manasa', 'Mandakini', 'Mangamma', 'Manisha', 'Manjula', 'Manogna', 'Meena', 'Meenakshi', 'Meghana', 'Menaka', 'Mounika', 'Mrudula', 'Nagalakshmi', 'Nagamani', 'Nalini', 'Namratha', 'Nandini', 'Navya', 'Nayana', 'Neelima', 'Neeraja', 'Neha', 'Niharika', 'Nikhila', 'Nikitha', 'Nirmala', 'Nisha', 'Nishitha', 'Nithya', 'Niveditha', 'Padma', 'Padmaja', 'Padmavathi', 'Pallavi', 'Parvathi', 'Pavani', 'Pavithra', 'Pooja', 'Poojitha', 'Poonam', 'Poornima', 'Prabhavathi', 'Pragathi', 'Prameela', 'Pramila', 'Pranathi', 'Pranavi', 'Pranitha', 'Prasanna', 'Prashanthi', 'Prathima', 'Prathyusha', 'Pravalika', 'Praveena', 'Preethi', 'Prema', 'Priya', 'Priyanka', 'Pushpa', 'Pushpalatha', 'Radha', 'Radhika', 'Ragini', 'Rajeswari', 'Rajitha', 'Ramadevi', 'Ramani', 'Ramya', 'Rani', 'Ranjani', 'Ranjitha', 'Rashmi', 'Rathna', 'Ravali', 'Ravalika', 'Rekha', 'Renuka', 'Reshma', 'Revathi', 'Rishitha', 'Rohini', 'Roja', 'Roopa', 'Roshini', 'Rukmini', 'Sadhana', 'Sahasra', 'Sahithi', 'Sailaja', 'Saisree', 'Sakshi', 'Sandhya', 'Sangeetha', 'Sanjana', 'Santhi', 'Santhoshi', 'Sarada', 'Sarala', 'Saraswathi', 'Saritha', 'Sarojini', 'Sathvika', 'Satyavathi', 'Saumya', 'Savitha', 'Seetha', 'Shailaja', 'Shakuntala', 'Shalini', 'Shamala', 'Shanthi', 'Sharada', 'Sharanya', 'Sharmila', 'Sheetal', 'Shilpa', 'Shirisha', 'Shivani', 'Shobha', 'Shraddha', 'Shravani', 'Shravya', 'Shreya', 'Shruthi', 'Shwetha', 'Siddhi', 'Sindhu', 'Sindhuja', 'Sireesha', 'Sirisha', 'Sita', 'Sivani', 'Smitha', 'Sneha', 'Snehalatha', 'Sowjanya', 'Sowmya', 'Spandana', 'Sravani', 'Sravanthi', 'Sreedevi', 'Sreeja', 'Sreelatha', 'Sreelekha', 'Sreenidhi', 'Sreevani', 'Sridevi', 'Srilakshmi', 'Srilatha', 'Srivalli', 'Srivani', 'Srividya', 'Subbalakshmi', 'Subhashini', 'Suchitra', 'Sudha', 'Sudharani', 'Suguna', 'Suhasini', 'Sujatha', 'Sukanya', 'Sulochana', 'Sumalatha', 'Sumathi', 'Sumedha', 'Sunanda', 'Sunitha', 'Supriya', 'Surabhi', 'Surekha', 'Susheela', 'Sushma', 'Sushmitha', 'Swapna', 'Swarna', 'Swarnalatha', 'Swathi', 'Swetha', 'Tanmayi', 'Tanuja', 'Tanvi', 'Tejaswi', 'Tejaswini', 'Thulasi', 'Triveni', 'Tulasi', 'Udaya', 'Uma', 'Umadevi', 'Urmila', 'Usha', 'Usharani', 'Vaidehi', 'Vaishnavi', 'Vandana', 'Vani', 'Vanitha', 'Varalakshmi', 'Varsha', 'Varshini', 'Vasantha', 'Vasavi', 'Vasundhara', 'Vedavathi', 'Veena', 'Vennela', 'Vidya', 'Vijaya', 'Vijayalakshmi', 'Vimala', 'Vinaya', 'Vineela', 'Vinitha', 'Vinoda', 'Vishali', 'Vishnupriya', 'Yamini', 'Yamuna', 'Yashoda',
]

# North, Central, West and East Indian, including Muslim and Punjabi names
NORTH_INDIAN_NAMES: List[str] = [
    # Male
    'Aadesh', 'Aadil', 'Aakash', 'Aamir', 'Aaryan', 'Aashish', 'Abdul', 'Abdullah', 'Abhay', 'Adil', 'Aftab', 'Ahmed', 'Ajit', 'Akash', 'Akbar', 'Akhilesh', 'Akram', 'Alam', 'Ali', 'Alok', 'Altaf', 'Aman', 'Amandeep', 'Amarjeet', 'Ameer', 'Amitabh', 'Amjad', 'Amrit', 'Amritpal', 'Anirban', 'Ankur', 'Anmol', 'Ansar', 'Ansh', 'Anshul', 'Anshuman', 'Anup', 'Anupam', 'Anwar', 'Arbaz', 'Arif', 'Armaan', 'Arpit', 'Arshad', 'Aryan', 'Asad', 'Ashfaq', 'Ashraf', 'Ashutosh', 'Asif', 'Aslam', 'Atharva', 'Atif', 'Atul', 'Avtar', 'Ayaz', 'Ayush', 'Ayushman', 'Azad', 'Azhar', 'Azim', 'Bablu', 'Badal', 'Bahadur', 'Balbir', 'Baldev', 'Baljit', 'Balram', 'Balwant', 'Banwari', 'Basant', 'Bashir', 'Bhagat', 'Bhagwan', 'Bharat', 'Bhavesh', 'Bhola', 'Bhupendra', 'Bhupesh', 'Bijay', 'Bikash', 'Bikram', 'Bilal', 'Bimal', 'Binod', 'Bipin', 'Birendra', 'Brijesh', 'Chander', 'Chandrakant', 'Chandraprakash', 'Charanjit', 'Chirag', 'Dalbir', 'Dalip', 'Daljit', 'Danish', 'Daya', 'Dayanand', 'Debashish', 'Deepanshu', 'Devesh', 'Dhananjay', 'Dharmendra', 'Dhruv', 'Digvijay', 'Dilawar', 'Dildar', 'Divyanshu', 'Diwakar', 'Durgesh', 'Ehsan', 'Ekansh', 'Faiz', 'Faizan', 'Farhan', 'Farooq', 'Feroz', 'Firoz', 'Gagan', 'Gagandeep', 'Gaurav', 'Ghanshyam', 'Gobind', 'Gourav', 'Gulshan', 'Gulzar', 'Gunjan', 'Gurbachan', 'Gurcharan', 'Gurdeep', 'Gurjant', 'Gurmeet', 'Gurnam', 'Gurpreet', 'Gursevak', 'Gurwinder', 'Habib', 'Haider', 'Hameed', 'Hamid', 'Hanif', 'Hansraj', 'Hanuman', 'Hardik', 'Harendra', 'Haresh', 'Hari', 'Harjeet', 'Harjinder', 'Harkirat', 'Harminder', 'Harpal', 'Harpreet', 'Harsh', 'Harshit', 'Harvinder', 'Hasan', 'Hashim', 'Hemant', 'Hitesh', 'Hussain', 'Ibrahim', 'Idris', 'Ikram', 'Iliyas', 'Imran', 'Inder', 'Inderjeet', 'Inderpal', 'Indrajeet', 'Iqbal', 'Irfan', 'Irshad', 'Ishaan', 'Ishwar', 'Ismail', 'Jafar', 'Jagdeep', 'Jagdish', 'Jagjit', 'Jagmohan', 'Jaipal', 'Jaiprakash', 'Jaspal', 'Jaspreet', 'Jaswant', 'Jaswinder', 'Javed', 'Jawahar', 'Jayant', 'Jayesh', 'Jeet', 'Jeetendra', 'Joginder', 'Junaid', 'Kabir', 'Kaleem', 'Kalpesh', 'Kamlesh', 'Kamran', 'Kanhaiya', 'Kapil', 'Karam', 'Karamjit', 'Karan', 'Karim', 'Kartik', 'Kartikeya', 'Kashif', 'Kaushal', 'Khalid', 'Khushwant', 'Kishan', 'Kuldeep', 'Kulwant', 'Kulwinder', 'Kunal', 'Kundan', 'Lakshay', 'Lalit', 'Laxman', 'Lucky', 'Madan', 'Mahavir', 'Mahipal', 'Majid', 'Malkeet', 'Malkiat', 'Manan', 'Manav', 'Mandeep', 'Mangal', 'Maninder', 'Manjeet', 'Manjit', 'Manmohan', 'Mansoor', 'Manu', 'Mayank', 'Mehboob', 'Mehul', 'Milind', 'Mithilesh', 'Mithun', 'Mohammad', 'Mohammed', 'Mohit', 'Mohsin', 'Moin', 'Monu', 'Mubarak', 'Mudassir', 'Mukhtar', 'Mukul', 'Munish', 'Munna', 'Murari', 'Murtaza', 'Mushtaq', 'Mustafa', 'Nadeem', 'Naeem', 'Naseem', 'Naseer', 'Nasir', 'Navdeep', 'Navin', 'Navjot', 'Nawab', 'Nazar', 'Neeraj', 'Nirmal', 'Nishant', 'Nitin', 'Nizam', 'Noor', 'Om', 'Omprakash', 'Osman', 'Pankaj', 'Paramjeet', 'Paramjit', 'Paras', 'Paresh', 'Pargat', 'Parmod', 'Parth', 'Parvez', 'Parwinder', 'Pawan', 'Piyush', 'Prabhat', 'Prabhjot', 'Prafulla', 'Prashant', 'Prateek', 'Pravin', 'Prince', 'Pritam', 'Puneet', 'Pushpendra', 'Qasim', 'Rafi', 'Rafiq', 'Raghvendra', 'Rahim', 'Rahman', 'Rajan', 'Rajat', 'Rajender', 'Rajinder', 'Rajkumar', 'Rajneesh', 'Rajnish', 'Raman', 'Ramandeep', 'Rameshwar', 'Ramkishan', 'Ramlal', 'Ramniwas', 'Rampal', 'Ramprakash', 'Ramzan', 'Ranbir', 'Randeep', 'Randhir', 'Ranjeet', 'Ranjit', 'Ranveer', 'Ranvijay', 'Rasheed', 'Rashid', 'Ratan', 'Ratnesh', 'Ravinder', 'Ravish', 'Raza', 'Rehan', 'Rinku', 'Rishabh', 'Ritesh', 'Rizwan', 'Robin', 'Rupesh', 'Rustam', 'Saad', 'Sabir', 'Sachin', 'Saddam', 'Sadiq', 'Saif', 'Sajid', 'Sajjad', 'Saleem', 'Salim', 'Salman', 'Sameer', 'Samir', 'Santosh', 'Sarabjit', 'Sarfaraz', 'Sarvesh', 'Satbir', 'Satnam', 'Satpal', 'Sattar', 'Satyam', 'Satyendra', 'Shabir', 'Shadab', 'Shafi', 'Shahbaz', 'Shaheed', 'Shahid', 'Shahrukh', 'Shailendra', 'Shailesh', 'Shakeel', 'Shakir', 'Shakti', 'Shambhu', 'Shameem', 'Shamim', 'Shamsher', 'Shantanu', 'Sharad', 'Sharik', 'Shashikant', 'Shekhar', 'Sher', 'Shishpal', 'Shiv', 'Shivam', 'Shivkumar', 'Shoaib', 'Shrikant', 'Shubham', 'Sikandar', 'Simranjit', 'Sohail', 'Somnath', 'Sonu', 'Sourabh', 'Sourav', 'Subodh', 'Sudesh', 'Sudhir', 'Suhail', 'Sukhbir', 'Sukhdev', 'Sukhjit', 'Sukhwinder', 'Suleman', 'Sultan', 'Sunder', 'Sunny', 'Surender', 'Surinder', 'Surjit', 'Sushil', 'Swaran', 'Syed', 'Tahir', 'Tajinder', 'Talib', 'Tanmay', 'Tanveer', 'Tapan', 'Tapas', 'Tariq', 'Taufik', 'Taufiq', 'Tej', 'Tejinder', 'Tejpal', 'Thakur', 'Tinku', 'Trilok', 'Tushar', 'Udit', 'Umar', 'Usman', 'Uttam', 'Vaibhav', 'Ved', 'Vedprakash', 'Veer', 'Veerendra', 'Vikramjit', 'Vikrant', 'Vimal', 'Vineet', 'Vipin', 'Vipul', 'Virender', 'Virendra', 'Vishwajeet', 'Waseem', 'Wasim', 'Yashpal', 'Yashwant', 'Yogendra', 'Yunus', 'Yusuf', 'Zafar', 'Zaheer', 'Zahid', 'Zaid', 'Zakir', 'Zeeshan', 'Zubair',
    # Female
    'Aachal', 'Aafreen', 'Aakanksha', 'Aaliya', 'Aarzoo', 'Aasha', 'Aashi', 'Aashna', 'Aastha', 'Abha', 'Afreen', 'Afsana', 'Aisha', 'Akanksha', 'Akriti', 'Alisha', 'Alka', 'Amina', 'Amrita', 'Anamika', 'Anchal', 'Anita', 'Anju', 'Ankita', 'Anshika', 'Anshu', 'Antara', 'Anubha', 'Aradhana', 'Arifa', 'Arpita', 'Arti', 'Ashima', 'Asma', 'Avni', 'Ayesha', 'Babita', 'Baljeet', 'Balwinder', 'Bandana', 'Barkha', 'Basanti', 'Beena', 'Benazir', 'Bharti', 'Bhawna', 'Bhumika', 'Bimla', 'Binita', 'Bushra', 'Chanchal', 'Chanda', 'Chandni', 'Charu', 'Chetna', 'Chhaya', 'Damini', 'Darshana', 'Deepali', 'Deepti', 'Dhanwanti', 'Diksha', 'Dimple', 'Disha', 'Dolly', 'Ekta', 'Farah', 'Farhana', 'Farida', 'Fatima', 'Fauzia', 'Firdaus', 'Gargi', 'Garima', 'Gauri', 'Gayatri', 'Geeta', 'Geetanjali', 'Ghazala', 'Gulnaz', 'Habiba', 'Hajra', 'Halima', 'Hameeda', 'Harleen', 'Harman', 'Harshita', 'Heena', 'Hemlata', 'Hina', 'Huma', 'Iram', 'Isha', 'Ishita', 'Ishrat', 'Jabeen', 'Jahanara', 'Janki', 'Jasleen', 'Jasmeen', 'Jayanti', 'Juhi', 'Jyoti', 'Kajal', 'Kajol', 'Kalpana', 'Kamaljit', 'Kamini', 'Kamla', 'Kanchan', 'Kanika', 'Kanta', 'Kareena', 'Karishma', 'Kaur', 'Kaushalya', 'Kavita', 'Khushboo', 'Khushi', 'Kirti', 'Koyal', 'Kriti', 'Kritika', 'Kumkum', 'Kusum', 'Lajwanti', 'Lalita', 'Lata', 'Latika', 'Laxmi', 'Leena', 'Lovely', 'Mahima', 'Maimoona', 'Mala', 'Malini', 'Mamta', 'Manasi', 'Mandira', 'Manju', 'Manorama', 'Manpreet', 'Mansi', 'Mariam', 'Maryam', 'Maya', 'Meenu', 'Meera', 'Megha', 'Mehak', 'Mehrunnisa', 'Mohini', 'Mona', 'Monica', 'Monika', 'Mridula', 'Mumtaz', 'Munni', 'Muskan', 'Nadia', 'Nafeesa', 'Nagma', 'Naina', 'Namita', 'Namrata', 'Nargis', 'Nasreen', 'Nazia', 'Nazma', 'Neelam', 'Neelu', 'Neena', 'Neeru', 'Neeta', 'Neetu', 'Nidhi', 'Nikita', 'Nilam', 'Nilofer', 'Nimmi', 'Nimrat', 'Nishat', 'Nishtha', 'Niti', 'Nitya', 'Nivedita', 'Noorjahan', 'Nusrat', 'Parul', 'Parveen', 'Payal', 'Pinky', 'Prabha', 'Prachi', 'Pragati', 'Pragya', 'Pratibha', 'Pratima', 'Preeti', 'Prerna', 'Puja', 'Punam', 'Purnima', 'Rabia', 'Rachna', 'Rajani', 'Rajashree', 'Rajdeep', 'Rajeshwari', 'Rajni', 'Rajrani', 'Rajwinder', 'Rakhi', 'Rameshwari', 'Raminder', 'Ranjana', 'Rashida', 'Raveena', 'Razia', 'Reema', 'Reena', 'Reeta', 'Rehana', 'Renu', 'Rhea', 'Richa', 'Riddhi', 'Rihana', 'Rima', 'Rimjhim', 'Rina', 'Rinki', 'Rishika', 'Rita', 'Ritu', 'Riya', 'Rizwana', 'Roma', 'Roshni', 'Rubina', 'Ruby', 'Ruchi', 'Ruchika', 'Rukhsana', 'Rukhsar', 'Ruma', 'Rupa', 'Rupali', 'Rupinder', 'Saba', 'Sabina', 'Sabnam', 'Sadia', 'Saeeda', 'Sagarika', 'Saida', 'Saima', 'Saira', 'Sajida', 'Sakina', 'Salma', 'Samina', 'Samreen', 'Sana', 'Sanchita', 'Sangeeta', 'Sanjeeda', 'Sapna', 'Sarika', 'Sarita', 'Sarla', 'Saroj', 'Saroja', 'Satinder', 'Satwinder', 'Savita', 'Savitri', 'Seema', 'Shabana', 'Shabnam', 'Shagufta', 'Shaheen', 'Shahnaz', 'Shaila', 'Shakeela', 'Shama', 'Shanti', 'Sharda', 'Sheela', 'Shefali', 'Shehnaz', 'Shikha', 'Shivangi', 'Shrishti', 'Shruti', 'Shubhangi', 'Shweta', 'Simran', 'Simranjeet', 'Smita', 'Snehlata', 'Sofia', 'Sonal', 'Sonali', 'Sonam', 'Sonia', 'Soniya', 'Soumya', 'Srishti', 'Subhadra', 'Sucheta', 'Suhana', 'Sujata', 'Sukhdeep', 'Sultana', 'Sumitra', 'Sunaina', 'Suneeta', 'Sunita', 'Suraiya', 'Sushila', 'Swati', 'Sweta', 'Tabassum', 'Tahira', 'Tamanna', 'Tanisha', 'Tanu', 'Tara', 'Tarannum', 'Taruna', 'Tasleem', 'Tasneem', 'Trapti', 'Tripti', 'Trisha', 'Tulsi', 'Urvashi', 'Uzma', 'Vaishali', 'Vibha', 'Vidhi', 'Vimla', 'Vinita', 'Vishakha', 'Yashika', 'Yogita', 'Zahida', 'Zainab', 'Zarina', 'Zeba', 'Zeenat', 'Zoya', 'Zubeida',
]

# Christian and Anglo-Indian names common in India (Kerala, Goa, Northeast and elsewhere)
CHRISTIAN_NAMES: List[str] = [
    # Male
    'Aaron', 'Abel', 'Abraham', 'Alan', 'Albert', 'Alex', 'Alexander', 'Alfred', 'Allen', 'Alvin', 'Andrew', 'Anthony', 'Antony', 'Arnold', 'Arthur', 'Augustine', 'Austin', 'Benjamin', 'Benny', 'Benson', 'Bernard', 'Biju', 'Binu', 'Bobby', 'Bosco', 'Brian', 'Charles', 'Christopher', 'Clement', 'Cyril', 'Daniel', 'David', 'Dennis', 'Derek', 'Dominic', 'Edward', 'Edwin', 'Elias', 'Emmanuel', 'Eric', 'Felix', 'Fernando', 'Francis', 'Gabriel', 'George', 'Gilbert', 'Godwin', 'Gregory', 'Henry', 'Isaac', 'Jacob', 'James', 'Jason', 'Jerome', 'Jijo', 'Jinto', 'Jithin', 'Jobin', 'Joel', 'John', 'Johnson', 'Jomon', 'Jonathan', 'Jose', 'Joseph', 'Joshua', 'Jude', 'Justin', 'Kevin', 'Lawrence', 'Leo', 'Lijo', 'Lionel', 'Louis', 'Lucas', 'Luke', 'Manuel', 'Mark', 'Martin', 'Mathew', 'Matthew', 'Michael', 'Moses', 'Nelson', 'Nicholas', 'Nijo', 'Noel', 'Oscar', 'Patrick', 'Paul', 'Peter', 'Philip', 'Raymond', 'Richard', 'Rijo', 'Robert', 'Roy', 'Saju', 'Samson', 'Samuel', 'Sebastian', 'Shaju', 'Shibu', 'Sijo', 'Simon', 'Solomon', 'Stanley', 'Stephen', 'Subin', 'Thomas', 'Tony', 'Varghese', 'Victor', 'Vincent', 'William', 'Wilson', 'Xavier',
    # Female
    'Agnes', 'Aleena', 'Alice', 'Angela', 'Ann', 'Anna', 'Annamma', 'Annie', 'Beena', 'Bincy', 'Catherine', 'Celine', 'Christina', 'Daisy', 'Elizabeth', 'Esther', 'Flora', 'Florence', 'Gloria', 'Grace', 'Helen', 'Irene', 'Jacqueline', 'Jasmine', 'Jennifer', 'Jessy', 'Jincy', 'Jisha', 'Jomol', 'Josephine', 'Julie', 'Lilly', 'Lissy', 'Lucy', 'Margaret', 'Maria', 'Mary', 'Mercy', 'Merin', 'Molly', 'Philomena', 'Priscilla', 'Rachel', 'Rebecca', 'Rosamma', 'Rose', 'Rosemary', 'Rosy', 'Ruth', 'Sarah', 'Sheeba', 'Sherin', 'Siji', 'Sincy', 'Sophia', 'Stella', 'Susan', 'Teresa', 'Treesa', 'Veronica', 'Victoria',
]

SURNAMES: List[str] = [
    'Acharya', 'Agarwal', 'Ansari', 'Arora', 'Baig', 'Bajwa', 'Bakshi', 'Banerjee', 'Bansal', 'Bedi', 'Bhat', 'Bhatia', 'Bhatt', 'Bhattacharya', 'Biswas', 'Bose', 'Brar', 'Chakraborty', 'Chatterjee', 'Chaturvedi', 'Chauhan', 'Chavan', 'Cheema', 'Chishti', 'Chopra', 'Chowdary', 'Das', 'Desai', 'Deshmukh', 'Dhillon', 'Dubey', 'Dutta', 'Farooqui', 'Fernandes', 'Gaikwad', 'Gandhi', 'Ganguly', 'Ghosh', 'Gill', 'Goel', 'Gomes', 'Goud', 'Goyal', 'Grewal', 'Gupta', 'Hashmi', 'Hegde', 'Iyengar', 'Iyer', 'Jadhav', 'Jafri', 'Jain', 'Joshi', 'Kadam', 'Kamat', 'Kapoor', 'Khan', 'Khanna', 'Kohli', 'Krishnan', 'Kulkarni', 'Kurup', 'Lobo', 'Majumdar', 'Malhotra', 'Mann', 'Mansoori', 'Mascarenhas', 'Mehra', 'Mehta', 'Memon', 'Menon', 'Mirza', 'Mishra', 'Mittal', 'Modi', 'Mondal', 'Mukherjee', 'Murugan', 'Naidu', 'Nair', 'Nambiar', 'Naqvi', 'Natarajan', 'Pai', 'Pandey', 'Pandya', 'Panicker', 'Parekh', 'Parikh', 'Patel', 'Pathak', 'Pathan', 'Patil', 'Pawar', 'Pereira', 'Pillai', 'Pinto', 'Qureshi', 'Raghavan', 'Rajput', 'Randhawa', 'Rao', 'Rathore', 'Reddy', 'Rizvi', 'Rodrigues', 'Saha', 'Sandhu', 'Sarkar', 'Sastry', 'Saxena', 'Selvam', 'Sen', 'Sethi', 'Setty', 'Shah', 'Shaikh', 'Sharma', 'Shastri', 'Sheikh', 'Shenoy', 'Shetty', 'Shinde', 'Shukla', 'Siddiqui', 'Sidhu', 'Singh', 'Singhal', 'Sodhi', 'Solanki', 'Srivastava', 'Subramanian', 'Sundaram', 'Suri', 'Tandon', 'Tiwari', 'Tripathi', 'Trivedi', 'Upadhyay', 'Usmani', 'Varma', 'Venkataraman', 'Verma', 'Virk', 'Vyas', 'Warrier', 'Yadav', 'Zaidi',
]

# Names sent to Deepgram (speech-to-text) as "key terms" at the start of every English or Hindi call
# (see stt_service.py). Deepgram then hears these names right the first time, instead of English words
# ("Reddy", not "ready"). This is a separate, short list on purpose: Deepgram allows about 500 tokens of
# key terms, and a long list pulls unusual names towards common ones. Add names that keep coming out
# wrong in call transcripts. The full lists above are used only by the matcher below.
STT_KEYTERMS: List[str] = [
    # Common in Telangana / Andhra Pradesh
    "Srinivas", "Venkatesh", "Nagaraju", "Srikanth", "Sravan", "Vamsi", "Chaitanya", "Yadagiri", "Mallesh",
    "Lakshmi", "Padma", "Sravani", "Swathi", "Harika", "Mounika", "Keerthi", "Bhargavi", "Pavani", "Lavanya",
    "Sujatha", "Saritha", "Madhavi", "Bhavani", "Jyothi", "Manjula", "Sowmya",
    # Common across India
    "Ravi", "Suresh", "Ramesh", "Mahesh", "Rajesh", "Naveen", "Praveen", "Kiran", "Prasad", "Anil", "Sunil",
    "Vijay", "Harish", "Satish", "Sandeep", "Pradeep", "Karthik", "Murali", "Gopal", "Venu", "Mohan", "Arjun",
    "Rahul", "Rohit", "Amit", "Vikram", "Aditya", "Sai", "Krishna", "Raju",
    "Priya", "Divya", "Kavya", "Anjali", "Kavitha", "Sunitha", "Anitha", "Geetha", "Radha", "Rekha", "Usha",
    "Deepika", "Pooja", "Sneha", "Ramya", "Durga", "Vani",
    # Surnames
    "Reddy", "Rao", "Naidu", "Chowdary", "Goud", "Yadav", "Varma", "Sharma", "Gupta", "Kumar", "Kumari",
    "Devi", "Singh", "Patel", "Murthy", "Achari", "Setty", "Shetty", "Nair", "Iyer", "Babu",
]

# Words callers say around a name ("my name is", "it's for my mother"); never matched as a name on their own
FILLER_WORDS = {
    "a", "actually", "am", "an", "and", "appointment", "are", "booking", "brother", "call", "called", "calling",
    "correct", "dad", "daughter", "doctor", "dr", "father", "for", "full", "he", "her", "hello", "hi", "his", "i",
    "im", "is", "it", "its", "ji", "madam", "mam", "me", "miss", "mom", "mother", "mr", "mrs", "ms", "my",
    "name", "naam", "no", "not", "of", "ok", "okay", "patient", "please", "right", "she", "shri", "sir",
    "sister", "smt", "so", "son", "speaking", "sri", "that", "the", "this", "uh", "um", "wife", "husband",
    "wrong", "yeah", "yes", "hai", "mera", "meri", "uska", "unka", "surname", "last", "first",
}

# Everyday English words a caller may say in the same reply; never treated as a misheard name.
# ("ready" is left out on purpose: it is a common mishearing of Reddy.)
COMMON_WORDS = {
    "about", "after", "again", "ah", "all", "also", "any", "ask", "back", "be", "been", "before", "body", "book",
    "bye", "can", "check", "checkup", "clinic", "cold", "come", "coming", "consultation", "cough", "could", "day",
    "days", "did", "do", "does", "done", "eight", "english", "evening", "excuse", "fever", "fine", "five", "four",
    "from", "general", "get", "give", "go", "going", "good", "got", "had", "has", "have", "head", "help", "here",
    "hindi", "hmm", "hold", "hospital", "how", "just", "know", "like", "make", "mean", "medicine", "mine",
    "mobile", "morning", "much", "myself", "need", "night", "nine", "number", "oh", "one", "only", "other", "our",
    "pain", "phone", "pressure", "problem", "said", "same", "say", "see", "seven", "since", "six", "some", "sorry",
    "speak", "stomach", "sugar", "sure", "take", "talk", "telugu", "tell", "ten", "thank", "thanks", "their",
    "them", "there", "they", "think", "three", "time", "today", "tomorrow", "two", "us", "very", "visit", "wait",
    "want", "was", "we", "week", "weeks", "well", "were", "what", "when", "where", "which", "who", "why", "will",
    "with", "would", "yesterday", "you", "your", "yours", "afternoon", "noon", "evening", "hello", "agent",
}
FILLER_WORDS |= COMMON_WORDS

# The agent asked for a name if its last reply has one of these (English, Hindi, Telugu)
NAME_QUESTION_WORDS = ("name", "naam", "नाम", "పేరు")


# ==============================================================================
# 2. MATCHER
# ==============================================================================

class IndianNameMatcher:
    """Indian names indexed by a sound key, loaded once at startup."""

    # Only suggest a name this similar (0..1) to what was heard; lower = more guesses, more wrong ones
    MIN_SCORE = 0.72

    def __init__(self) -> None:
        names = sorted(set(SOUTH_INDIAN_NAMES + NORTH_INDIAN_NAMES + CHRISTIAN_NAMES + SURNAMES))
        self.names = names
        self.exact: Dict[str, str] = {name.lower(): name for name in names}
        # (name, lowercase, sound key), grouped by the key's first letter so a lookup only scans one group
        self._index: Dict[str, List[Tuple[str, str, str]]] = {}
        for name in names:
            key = self.sound_key(name)
            self._index.setdefault(key[:1], []).append((name, name.lower(), key))

    @staticmethod
    def sound_key(word: str) -> str:
        """A consonant "sound key": names that sound alike on a phone line get the same key.

        Groups:  K = k c q g (and kh gh)   T = t d (and th dh)   P = p b f v w (and ph bh)
                 S = s z j (and sh ch zh, and c before e/i/y)    N = n m    x = ks
        Vowels and h are dropped after the first letter; a first vowel becomes "a".
        Examples: Suresh / Shuresh / sir ish -> srs, Lakshmi / lux me -> lksn, Vamsi / bouncy -> pns
        """
        w = re.sub(r"[^a-z]", "", word.lower())
        if not w:
            return ""
        w = w.replace("x", "ks")
        w = re.sub(r"c(?=[eiy])", "s", w)  # "c" sounds like "s" before e, i, y ("bouncy")
        for pair, single in (("ph", "p"), ("bh", "p"), ("kh", "k"), ("gh", "k"), ("ck", "k"), ("qu", "k"),
                             ("th", "t"), ("dh", "t"), ("sh", "s"), ("ch", "s"), ("zh", "s")):
            w = w.replace(pair, single)
        w = w.translate(str.maketrans("cqgdbfvwzjm", "kkktppppssn"))
        first = "a" if w[0] in "aeiouy" else w[0]
        key = [first]
        for ch in w[1:]:
            if ch not in "aeiouyh" and ch != key[-1]:
                key.append(ch)
        return "".join(key)

    def is_known(self, word: str) -> bool:
        return word.lower() in self.exact

    def match_name(self, heard: str, top_k: int = 3) -> List[Tuple[str, float]]:
        """The names that best match a heard word or phrase, best first: [(name, score 0..1)].

        A phrase is matched as one word ("sir ish" -> "sirish"), because speech recognition often
        splits a name into two English words.
        """
        word = re.sub(r"[^a-z]", "", heard.lower())
        if len(word) < 3:
            return []
        if word in self.exact:
            return [(self.exact[word], 1.0)]
        key = self.sound_key(word)
        scored = []
        for name, lower, name_key in self._index.get(key[:1], []):  # the sound must start the same way
            # Cheap upper bound first: skip names that cannot reach the bar
            if abs(len(name_key) - len(key)) > 3:
                continue
            key_sim = SequenceMatcher(None, key, name_key).ratio()
            if key_sim < 0.6:
                continue
            text_sim = SequenceMatcher(None, word, lower).ratio()
            score = round(0.4 * text_sim + 0.6 * key_sim, 3)
            if score >= self.MIN_SCORE:
                scored.append((name, score))
        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:top_k]

    def find_misheard_names(self, text: str) -> List[Tuple[str, List[str]]]:
        """Words in the caller's reply that look like a misheard Indian name: [(heard, [likely names])].

        Words that already are a known name are left alone (heard right). Only English letters are
        checked (Hindi or Telugu script is skipped).
        """
        tokens = re.findall(r"[a-z']+", text.lower().replace("’", "'"))
        tokens = [t.replace("'", "") for t in tokens]
        # Every one- and two-word span ("lux me" as well as "lux"), scored; the best spans win
        options = []
        for size in (1, 2):
            for start in range(len(tokens) - size + 1):
                words = tokens[start:start + size]
                # Skip what is only filler, or contains a name that was heard right
                if all(w in FILLER_WORDS for w in words) or any(self.is_known(w) for w in words):
                    continue
                matches = self.match_name("".join(words))
                if matches:
                    options.append((matches[0][1], start, size, " ".join(words), [n for n, _ in matches[:3]]))
        found: List[Tuple[int, str, List[str]]] = []
        used = set()
        for _, start, size, heard, names in sorted(options, key=lambda o: o[0], reverse=True):
            span = set(range(start, start + size))
            if span & used:
                continue
            used |= span
            found.append((start, heard, names))
        return [(heard, names) for _, heard, names in sorted(found)[:2]]

    def build_llm_name_hint(self, text: str) -> Optional[str]:
        """A private note for the agent when the caller's reply may hold a misheard Indian name, else None."""
        found = self.find_misheard_names(text)
        if not found:
            return None
        guesses = "; ".join(f"\"{heard}\" may be {' or '.join(names)}" for heard, names in found)
        return (
            f"NAME CHECK (from the system, not the caller): speech recognition may have misheard the name in the "
            f"caller's last reply. {guesses}. If one of these fits, use it, then check it with the caller as usual "
            f"(\"Just to confirm, the patient's name is ..., is that correct?\"). Never ask them to spell it."
        )


def asked_for_name(agent_reply: str) -> bool:
    """True if the agent's reply asked for (or checked) a name."""
    reply = agent_reply.lower()
    return any(word in reply for word in NAME_QUESTION_WORDS)


# Loaded once when the backend starts
name_matcher = IndianNameMatcher()
